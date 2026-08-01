-- Owner/dispatcher SMS notification on each new booking.
--
-- The AI books jobs while nobody's watching a dashboard — a truck driver or
-- a one-person HVAC/plumbing outfit isn't tab-checking a console between
-- calls. This gives the engine a phone number to text the moment
-- book_appointment confirms (see services/tools/handlers.js).
--
-- Nullable and opt-in: unset means no notification fires (see
-- services/twilio.js notifyOwner()).

alter table tenants add column if not exists notify_phone text;
