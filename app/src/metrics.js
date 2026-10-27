// The one place business numbers are defined. Home, Live, Insights and the AI team read them from here,
// so the same question always gets the same number on every screen.
//   booking      a booking that was not cancelled
//   AI booking   a booking made by the receptionist (chat) or the online booking page (web)
//   revenue      the price of non-cancelled appointments that start in the period
//   "today"      the business's own calendar day (its time zone), not the server's
import { q, one } from './db.js';

export const TZ = `COALESCE((SELECT timezone FROM businesses WHERE id=$1),'Asia/Beirut')`;
export const ACTIVE = `status <> 'cancelled'`;
export const AI_SOURCE = `source IN ('ai','web')`;
const isToday = col => `(${col} AT TIME ZONE ${TZ})::date = (now() AT TIME ZONE ${TZ})::date`;

// today's figures for one business: appointments and revenue by start time, new bookings by when they were made
export const today = B => one(`SELECT
    count(*) FILTER (WHERE ${isToday('starts_at')})::int AS visits_today,
    COALESCE(sum(price) FILTER (WHERE ${isToday('starts_at')}),0)::float AS revenue_today,
    count(*) FILTER (WHERE ${isToday('created_at')})::int AS booked_today,
    COALESCE(sum(price) FILTER (WHERE ${isToday('created_at')}),0)::float AS value_today
  FROM bookings WHERE business_id=$1 AND ${ACTIVE}`, [B]);

// AI bookings made in the last `days` days, and in the `days` before that for the trend
export const aiBookings = (B, days) => one(`SELECT
    count(*) FILTER (WHERE created_at > now() - make_interval(days => $2))::int AS ai_count,
    COALESCE(sum(price) FILTER (WHERE created_at > now() - make_interval(days => $2)),0)::float AS ai_value,
    COALESCE(sum(price) FILTER (WHERE created_at <= now() - make_interval(days => $2) AND created_at > now() - make_interval(days => $2 * 2)),0)::float AS ai_value_prev
  FROM bookings WHERE business_id=$1 AND ${ACTIVE} AND ${AI_SOURCE}`, [B, days]);

// One row per day of the business's calendar for the last `days` days: what the Today tiles and their sparklines show.
//   bookings   new non-cancelled bookings made that day          revenue  price of appointments starting that day
//   chats      conversations started (test chats excluded)       handled  share of those the AI finished without a person
//   reply_ms   average AI reply time
export const daily = (B, days) => q(`WITH d AS (SELECT generate_series((now() AT TIME ZONE ${TZ})::date - ($2::int - 1), (now() AT TIME ZONE ${TZ})::date, '1 day')::date AS day)
  SELECT to_char(d.day,'YYYY-MM-DD') AS day,
    (SELECT count(*) FROM bookings b WHERE b.business_id=$1 AND b.${ACTIVE} AND (b.created_at AT TIME ZONE ${TZ})::date=d.day)::int AS bookings,
    (SELECT COALESCE(sum(price),0) FROM bookings b WHERE b.business_id=$1 AND b.${ACTIVE} AND (b.starts_at AT TIME ZONE ${TZ})::date=d.day)::float AS revenue,
    (SELECT count(*) FROM conversations c WHERE c.business_id=$1 AND c.channel<>'test' AND (c.created_at AT TIME ZONE ${TZ})::date=d.day)::int AS chats,
    (SELECT count(*) FROM conversations c WHERE c.business_id=$1 AND c.channel<>'test' AND COALESCE(c.outcome,'')<>'handoff' AND (c.created_at AT TIME ZONE ${TZ})::date=d.day)::int AS handled,
    (SELECT round(avg(m.latency_ms))::int FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.business_id=$1 AND m.role='assistant' AND NOT m.failed
       AND (m.created_at AT TIME ZONE ${TZ})::date=d.day) AS reply_ms
  FROM d ORDER BY d.day`, [B, days]);
