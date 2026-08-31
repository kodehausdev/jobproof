// Gemini function-calling declarations. These are shared verbatim by the
// text path (generateContent tools) and the voice path (Live API setup
// message). Argument whitelists here are also what hipaa.guardToolArgs
// enforces — the schema IS the collection policy.

// Placeholder service catalog — broad enough to fit most home-service
// trades for demo purposes. Swap for the real launch service list
// (see CLAUDE.md: tool vocabulary needs real input on what ships first).
const TEST_CATALOG = [
  { code: 'SERVICE_CALL', name: 'Service Call / Diagnostic', duration_min: 30 },
  { code: 'REPAIR', name: 'Repair', duration_min: 60 },
  { code: 'INSTALLATION', name: 'Installation', duration_min: 90 },
  { code: 'MAINTENANCE', name: 'Routine Maintenance', duration_min: 45 },
  { code: 'INSPECTION', name: 'Inspection', duration_min: 30 },
  { code: 'EMERGENCY_SERVICE', name: 'Emergency Service', duration_min: 30 },
];

const functionDeclarations = [
  {
    name: 'list_available_tests',
    description:
      'List the services this location offers. Use when the caller asks what services are available or names a service you cannot match to the catalog.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'check_availability',
    description:
      'Check open appointment slots for a given date. Optionally narrow to a specific time slot. Dates are YYYY-MM-DD; time slots are 24h HH:MM.',
    parameters: {
      type: 'OBJECT',
      properties: {
        date: {
          type: 'STRING',
          description: 'Requested date in YYYY-MM-DD format.',
        },
        time_slot: {
          type: 'STRING',
          description: 'Optional specific slot in HH:MM 24h format, e.g. "10:00".',
        },
      },
      required: ['date'],
    },
  },
  {
    name: 'book_appointment',
    description:
      'Book a service appointment. Only call once you have confirmed customer name, service type, date and time slot with the caller. Do NOT ask for a phone number — the system books against caller ID automatically. NEVER pass payment card numbers, CVVs, bank details, or SSNs — they are not accepted.',
    parameters: {
      type: 'OBJECT',
      properties: {
        client_name: { type: 'STRING', description: 'Customer full name.' },
        phone_number: {
          type: 'STRING',
          description:
            'Optional. Omit it — the caller ID is used automatically. Only pass a number if the caller explicitly asks to use a different one.',
        },
        test_type: {
          type: 'STRING',
          description: `One of the catalog service names: ${TEST_CATALOG.map(t => t.name).join(', ')}.`,
        },
        date: { type: 'STRING', description: 'YYYY-MM-DD.' },
        time_slot: { type: 'STRING', description: 'HH:MM 24h, on a 30-minute boundary.' },
      },
      required: ['client_name', 'test_type', 'date', 'time_slot'],
    },
  },
  {
    name: 'find_my_appointments',
    description:
      'Look up the caller\'s upcoming confirmed appointments at this business, matched automatically by their caller ID. Use before cancelling or rescheduling, or when the caller asks about an existing appointment. Takes no arguments.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'cancel_appointment',
    description:
      'Cancel one of the caller\'s upcoming appointments. Only call after find_my_appointments returned the booking and the caller explicitly confirmed which one to cancel. To reschedule: cancel the old appointment, then book the new slot with book_appointment.',
    parameters: {
      type: 'OBJECT',
      properties: {
        booking_id: {
          type: 'NUMBER',
          description: 'The booking_id returned by find_my_appointments.',
        },
      },
      required: ['booking_id'],
    },
  },
];

// Per-tool argument whitelists consumed by hipaa.guardToolArgs.
const TOOL_ARG_WHITELIST = {
  list_available_tests: [],
  check_availability: ['date', 'time_slot'],
  book_appointment: ['client_name', 'phone_number', 'test_type', 'date', 'time_slot'],
  find_my_appointments: [],
  cancel_appointment: ['booking_id'],
};

module.exports = { functionDeclarations, TOOL_ARG_WHITELIST, TEST_CATALOG };
