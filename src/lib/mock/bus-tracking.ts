// RETIRED (7-b — Mock Data Elimination): the fabricated live-GPS universe
// below (fake ETA/speed/fuel/temperature, invented driver + attendant
// phone numbers, per-stop arrival times, trip history and on-time stats)
// is NO LONGER CONSUMED by any component. The Student Transport module
// now reads the REAL route assignment from GET /api/student/dashboard
// and renders an honest "Live bus tracking is not available yet" state.
// Kept on disk for reference only — do not import from new code.

// Student bus tracking data — for the student's own route

export interface BusStop {
  id: string
  name: string
  scheduledTime: string
  actualTime?: string
  status: 'completed' | 'current' | 'upcoming'
  students: number
}

export const myBusRoute = {
  routeNo: 'Route 4',
  routeName: 'Sohna Road & Sector 49',
  vehicleNo: 'HR-26-GH-4512',
  driverName: 'Pradeep Sharma',
  driverPhone: '+91 98400 44444',
  attendant: 'Ramesh Kumar',
  attendantPhone: '+91 98111 22334',
  capacity: 48,
  studentsOnboard: 44,
  myStop: 'Stop 6 — Sector 49 Chowk',
  pickupTime: '07:25 AM',
  dropTime: '02:45 PM',
  currentSpeed: 32,
  distanceCovered: 8.4,
  totalDistance: 12.6,
  etaMinutes: 14,
  status: 'On Route',
  fuelLevel: 78,
  temperature: 22,
  lastUpdate: '2 sec ago',
}

export const myBusStops: BusStop[] = [
  { id: 'S01', name: 'School Campus', scheduledTime: '07:00 AM', actualTime: '07:02 AM', status: 'completed', students: 0 },
  { id: 'S02', name: 'Sector 42 Gate', scheduledTime: '07:08 AM', actualTime: '07:10 AM', status: 'completed', students: 8 },
  { id: 'S03', name: 'DLF Phase 5', scheduledTime: '07:14 AM', actualTime: '07:15 AM', status: 'completed', students: 14 },
  { id: 'S04', name: 'Sector 40 Chowk', scheduledTime: '07:20 AM', actualTime: '07:19 AM', status: 'completed', students: 22 },
  { id: 'S05', name: 'Sohna Road Junction', scheduledTime: '07:22 AM', actualTime: '07:24 AM', status: 'current', students: 32 },
  { id: 'S06', name: 'Sector 49 Chowk (Your Stop)', scheduledTime: '07:25 AM', status: 'upcoming', students: 38 },
  { id: 'S07', name: 'South City 2', scheduledTime: '07:30 AM', status: 'upcoming', students: 40 },
  { id: 'S08', name: 'Sushant Lok Phase 2', scheduledTime: '07:35 AM', status: 'upcoming', students: 44 },
]

export const busTripHistory = [
  { id: 'TH01', date: '2024-11-28', pickupTime: '07:24 AM', dropTime: '02:44 PM', status: 'On Time', driver: 'Pradeep Sharma' },
  { id: 'TH02', date: '2024-11-27', pickupTime: '07:26 AM', dropTime: '02:48 PM', status: '2 min late', driver: 'Pradeep Sharma' },
  { id: 'TH03', date: '2024-11-26', pickupTime: '07:23 AM', dropTime: '02:42 PM', status: 'On Time', driver: 'Pradeep Sharma' },
  { id: 'TH04', date: '2024-11-25', pickupTime: '07:25 AM', dropTime: '02:45 PM', status: 'On Time', driver: 'Pradeep Sharma' },
  { id: 'TH05', date: '2024-11-22', pickupTime: '07:31 AM', dropTime: '02:52 PM', status: '6 min late', driver: 'Pradeep Sharma' },
]

export const busStats = {
  totalTrips: 142,
  onTimeRate: 94,
  avgPickupTime: '07:25 AM',
  avgDropTime: '02:45 PM',
  totalDistance: 1842,
  daysThisMonth: 18,
}
