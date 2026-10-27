// The one place business numbers are defined. Home, Live, Insights and the AI team read them from here,
// so the same question always gets the same number on every screen.
//   booking      a booking that was not cancelled
//   AI booking   a booking made by the receptionist (chat) or the online booking page (web)
//   revenue      the price of non-cancelled appointments that start in the period
//   "today"      the business's own calendar day (its time zone), not the server's
import { one } from './db.js';

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
