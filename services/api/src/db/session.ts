// 00-conventions.md: "today" is the IST calendar day. The app side already honours that
// (authz/clock.ts::todayIst, demands.ts::today); the DATABASE side didn't — PGlite's session
// TimeZone defaults to GMT (pg follows the server, also UTC on RDS), so every `CURRENT_DATE` in a
// seed, a write (journey/instances.ts actual_end) or an effective-dating read was one day behind
// IST between 00:00 and 05:30 IST. Found 2026-09-06 00:20 IST when two collections tests flipped
// a "due today" seed demand to OVERDUE. Both adapters pin the session clock with this statement.
export const DB_SESSION_TIME_ZONE = "Asia/Kolkata";
export const SET_SESSION_TIME_ZONE_SQL = `SET TIME ZONE '${DB_SESSION_TIME_ZONE}'`;
