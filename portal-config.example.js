// Copy this file to portal-config.js and fill in your Supabase project's public values.
// The anon key is intended for browser use when Row Level Security is enabled.
window.TENNIS_PORTAL_CONFIG = {
  supabaseUrl: 'https://YOUR_PROJECT_REF.supabase.co',
  supabaseAnonKey: 'YOUR_SUPABASE_ANON_KEY',
  // Sunday is 0; Monday through Saturday are 1 through 6. Replace the
  // placeholder names and change the days to match your leadership rota.
  coCeoLoginSchedule: {
    timeZone: 'Asia/Karachi',
    leaders: [
      { name: 'Co-CEO 1', activeDays: [1, 3, 5] },
      { name: 'Co-CEO 2', activeDays: [0, 2, 4, 6] }
    ]
  }
};
