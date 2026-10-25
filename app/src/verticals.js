// Business types ("verticals"). The engine is the same for all appointment-based businesses;
// a vertical only changes the words, the starter services/FAQs/policies and how the AI talks.
// Hotels book nights and rooms (check-in/out, inventory) and need their own module, so they are listed as coming soon.

export const VERTICALS = {
  salon: {
    label: 'Beauty salon', emoji: '💇', terms: { service: 'service', services: 'services', booking: 'appointment', bookings: 'appointments', customer: 'client', customers: 'clients', staff: 'stylist' },
    persona: 'a beauty salon front desk: warm, stylish, reassuring about results',
    services: [['Haircut & blow-dry', 35, 45, 'Wash, cut and blow-dry'], ['Hair colour', 90, 120, 'Full colour, includes toner'], ['Manicure', 20, 30, 'Shape, cuticles and polish'], ['Facial', 55, 60, 'Deep cleanse and mask']],
    faqs: [['Do you do bridal hair and makeup?', 'Yes, we do bridal packages. Send us your date and we will prepare a quote.'], ['Which brands do you use?', 'We use professional salon brands; ask us about a specific product.']],
    policies: 'Please arrive 5 minutes early. More than 15 minutes late may need to be rescheduled.',
  },
  barber: {
    label: 'Barbershop', emoji: '💈', terms: { service: 'service', services: 'services', booking: 'appointment', bookings: 'appointments', customer: 'client', customers: 'clients', staff: 'barber' },
    persona: 'a modern barbershop: friendly, relaxed and quick',
    services: [['Haircut', 15, 30, 'Clipper or scissor cut'], ['Beard trim', 10, 20, 'Shape and line-up'], ['Haircut + beard', 22, 45, 'Full package'], ['Kids cut', 12, 25, 'Under 12']],
    faqs: [['Do you take walk-ins?', 'Yes when a chair is free, but booking guarantees your time.']],
    policies: 'More than 10 minutes late may need to be rescheduled.',
  },
  clinic: {
    label: 'Medical clinic', emoji: '🩺', terms: { service: 'consultation', services: 'consultations', booking: 'appointment', bookings: 'appointments', customer: 'patient', customers: 'patients', staff: 'doctor' },
    persona: 'a medical clinic reception: calm, professional and discreet. Never give medical advice; hand medical questions to staff',
    services: [['General consultation', 40, 30, 'First visit or follow-up'], ['Follow-up visit', 25, 20, 'Within 30 days of a consultation'], ['Blood test', 20, 15, 'Fasting may be required']],
    faqs: [['Do you accept insurance?', 'Please send us the name of your insurance and we will confirm.'], ['Do I need to fast before a blood test?', 'For some tests yes; the team will confirm when you book.']],
    policies: 'Please bring your ID and any previous reports. Arrive 10 minutes early for a first visit.',
    ai_instructions: 'Never give medical advice or diagnoses. For symptoms, emergencies or results, hand off to staff and, for emergencies, tell them to call emergency services.',
  },
  dental: {
    label: 'Dental clinic', emoji: '🦷', terms: { service: 'treatment', services: 'treatments', booking: 'appointment', bookings: 'appointments', customer: 'patient', customers: 'patients', staff: 'dentist' },
    persona: 'a dental clinic reception: reassuring, professional, gentle with anxious patients. Never give medical advice',
    services: [['Check-up & cleaning', 50, 45, 'Exam, scaling and polish'], ['Filling', 70, 45, 'Per tooth'], ['Teeth whitening', 200, 60, 'In-clinic whitening'], ['Consultation', 30, 30, 'For new patients or a second opinion']],
    faqs: [['Is whitening painful?', 'Most patients feel little or no discomfort; the dentist will check first.']],
    policies: 'Please arrive 10 minutes early for your first visit.',
    ai_instructions: 'Never give medical advice. For pain or emergencies, hand off to staff immediately.',
  },
  spa: {
    label: 'Spa & massage', emoji: '🧖', terms: { service: 'treatment', services: 'treatments', booking: 'booking', bookings: 'bookings', customer: 'guest', customers: 'guests', staff: 'therapist' },
    persona: 'a calm, luxurious spa: soothing and attentive',
    services: [['Swedish massage', 60, 60, 'Relaxing full-body massage'], ['Deep tissue massage', 75, 60, 'Firm pressure for tension'], ['Hot stone massage', 85, 75, ''], ['Couples massage', 140, 60, 'Two therapists, same room']],
    faqs: [['What should I wear?', 'We provide robes and towels; just bring yourself.']],
    policies: 'Please arrive 15 minutes early to relax before your treatment.',
  },
  gym: {
    label: 'Gym / fitness studio', emoji: '🏋️', terms: { service: 'class', services: 'classes', booking: 'booking', bookings: 'bookings', customer: 'member', customers: 'members', staff: 'coach' },
    persona: 'an energetic fitness studio: motivating and friendly',
    services: [['Personal training', 30, 60, 'One-to-one session'], ['Group class', 10, 60, 'Up to 12 people'], ['Trial session', 0, 45, 'Free first visit']],
    faqs: [['Do I need to bring anything?', 'Comfortable clothes, trainers and a water bottle.']],
    policies: 'Please cancel classes at least 12 hours before so others can join.',
  },
  restaurant: {
    label: 'Restaurant / café', emoji: '🍽️', terms: { service: 'table', services: 'table types', booking: 'reservation', bookings: 'reservations', customer: 'guest', customers: 'guests', staff: 'host' },
    persona: 'a welcoming restaurant host: friendly and efficient. Ask for the number of guests and any occasion',
    services: [['Table for 2', 0, 90, 'Indoor or terrace on request'], ['Table for 4', 0, 105, ''], ['Group (6–10 people)', 0, 120, 'Set menu may apply']],
    faqs: [['Do you have vegetarian options?', 'Yes, several dishes on our menu are vegetarian.'], ['Can I bring a cake?', 'Yes, please mention it when booking.']],
    policies: 'Tables are held for 15 minutes after the reservation time.',
    ai_instructions: 'Always ask how many guests and note any occasion or allergy in the booking notes.',
  },
  car: {
    label: 'Car service / garage', emoji: '🚗', terms: { service: 'service', services: 'services', booking: 'appointment', bookings: 'appointments', customer: 'customer', customers: 'customers', staff: 'technician' },
    persona: 'a trustworthy garage: clear, practical and honest',
    services: [['Oil change', 40, 45, 'Oil and filter'], ['Full service', 120, 180, 'Inspection and fluids'], ['Car wash & detailing', 25, 60, 'Interior and exterior']],
    faqs: [['Can I wait while you work?', 'Yes, we have a waiting area with Wi-Fi.']],
    policies: 'Please share your car make, model and year when booking.',
    ai_instructions: 'Ask for the car make, model and year and put them in the booking notes.',
  },
  tutoring: {
    label: 'Tutoring / lessons', emoji: '📚', terms: { service: 'lesson', services: 'lessons', booking: 'session', bookings: 'sessions', customer: 'student', customers: 'students', staff: 'tutor' },
    persona: 'a friendly tutoring centre: encouraging and organised',
    services: [['Private lesson', 25, 60, 'One-to-one'], ['Group lesson', 12, 90, 'Up to 6 students'], ['Assessment', 0, 30, 'Free level check']],
    faqs: [['Do you teach online?', 'Yes, lessons can be online or in person.']],
    policies: 'Please cancel at least 24 hours before.',
  },
  hotel: {
    label: 'Hotel / guesthouse (coming soon)', emoji: '🏨', comingSoon: true,
    terms: { service: 'room', services: 'rooms', booking: 'stay', bookings: 'stays', customer: 'guest', customers: 'guests', staff: 'reception' },
    note: 'Hotels book nights (check-in/check-out) and room inventory. This needs the "stays" module, built on the same base.',
  },
};

export const listVerticals = () => Object.entries(VERTICALS).map(([key, v]) => ({ key, label: v.label, emoji: v.emoji, comingSoon: !!v.comingSoon, terms: v.terms, note: v.note }));
export const termsOf = key => (VERTICALS[key] || VERTICALS.salon).terms;
