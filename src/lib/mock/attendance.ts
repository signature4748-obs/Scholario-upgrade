// Attendance status vocabulary (shared type).
//
// Phase B (real-data QA): the FABRICATED DATA CORPUS that used to live
// here (attendanceOverview, classSections + rosters, staffAttendance,
// attendanceHistory, per-student calendars — deterministic fake numbers
// for the demo UI) is RETIRED. Every attendance surface now reads the
// canonical Attendance table through tenant-scoped APIs:
//
//   · GET /api/attendance/overview (school-wide or ?classId= scope) —
//     KPIs, trends, daily series, per-class summary + real roster
//   · GET /api/attendance?month=&classId= — the History tab
//   · POST /api/teacher/class-attendance/baseline — the canonical writer
//
// What remains is the shared status vocabulary (AttendanceStatus) used
// by the attendance-status.tsx meta table and store types. The values
// mirror the DB's Attendance.status whitelist (PRESENT/ABSENT/LATE/
// LEAVE), lowercased for the UI vocabulary.

export type AttendanceStatus = 'present' | 'late' | 'absent' | 'leave'
