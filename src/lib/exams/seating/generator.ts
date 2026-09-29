/**
 * Seating generator — allocates real students to seats with class mixing.
 */

import type { ExamRoom, Seat, SeatingPlan, SeatingStudent } from './types'

function positionsForType(type: string): string[] {
  if (type === 'double') return ['L', 'R']
  if (type === 'triple') return ['L', 'C', 'R']
  return []
}

/** Generate seat labels: Row A → A01, A02, ... Double: A01L, A01R. Triple: A01L, A01C, A01R. */
export function generateSeatsForRoom(room: ExamRoom): Seat[] {
  const seats: Seat[] = []
  let seatNum = 1
  const positions = positionsForType(room.seatingType)
  for (let r = 0; r < room.rows; r++) {
    const rowLabel = String.fromCharCode(65 + r)
    for (let c = 0; c < room.cols; c++) {
      if (positions.length === 0) {
        seats.push({
          id: `${room.id}-${rowLabel}${seatNum}`, roomId: room.id,
          seatNumber: `${rowLabel}${String(seatNum).padStart(2, '0')}`,
          rowIdx: r, colIdx: c, position: null,
          studentId: null, studentName: null, studentRollNo: null, className: null,
        })
      } else {
        for (const pos of positions) {
          seats.push({
            id: `${room.id}-${rowLabel}${seatNum}${pos}`, roomId: room.id,
            seatNumber: `${rowLabel}${String(seatNum).padStart(2, '0')}${pos}`,
            rowIdx: r, colIdx: c, position: pos,
            studentId: null, studentName: null, studentRollNo: null, className: null,
          })
        }
      }
      seatNum++
    }
  }
  return seats
}

/** Interleave students by class to avoid same-class adjacency. */
function interleaveByClass(students: SeatingStudent[]): SeatingStudent[] {
  const byClass = new Map<string, SeatingStudent[]>()
  for (const s of students) {
    if (!byClass.has(s.className)) byClass.set(s.className, [])
    byClass.get(s.className)!.push(s)
  }
  const classLists = Array.from(byClass.values())
  const result: SeatingStudent[] = []
  const maxLen = Math.max(0, ...classLists.map((l) => l.length))
  for (let i = 0; i < maxLen; i++) {
    for (const list of classLists) {
      if (i < list.length) result.push(list[i])
    }
  }
  return result
}

/** Generate a complete seating plan across all rooms. */
export function generateSeatingPlan(
  examId: string,
  rooms: ExamRoom[],
  studentsByClass: Map<string, SeatingStudent[]>,
): SeatingPlan {
  const allSeats: Seat[] = []
  const assignedStudentIds = new Set<string>()

  for (const room of rooms) {
    const roomSeats = generateSeatsForRoom(room)
    const eligible: SeatingStudent[] = []
    for (const classId of room.eligibleClassIds) {
      const classStudents = studentsByClass.get(classId) ?? []
      for (const s of classStudents) {
        if (!assignedStudentIds.has(s.id)) eligible.push(s)
      }
    }

    const shuffled = [...eligible].sort(() => Math.random() - 0.5)
    const interleaved = interleaveByClass(shuffled)

    for (let i = 0; i < Math.min(interleaved.length, roomSeats.length); i++) {
      const student = interleaved[i]
      const seat = roomSeats[i]
      seat.studentId = student.id
      seat.studentName = student.name
      seat.studentRollNo = student.rollNo
      seat.className = student.className
      assignedStudentIds.add(student.id)
    }
    allSeats.push(...roomSeats)
  }

  const totalCapacity = allSeats.length
  const totalAssigned = allSeats.filter((s) => s.studentId !== null).length
  const allEligibleIds = new Set<string>()
  for (const room of rooms) {
    for (const classId of room.eligibleClassIds) {
      for (const s of (studentsByClass.get(classId) ?? [])) allEligibleIds.add(s.id)
    }
  }
  const totalEligible = allEligibleIds.size
  const totalUnassigned = Math.max(0, totalEligible - totalAssigned)

  return { examId, rooms, seats: allSeats, totalCapacity, totalAssigned, totalUnassigned, fits: totalEligible <= totalCapacity }
}

export function seatsForRoom(plan: SeatingPlan, roomId: string): Seat[] {
  return plan.seats.filter((s) => s.roomId === roomId)
}

export function roomOccupancy(plan: SeatingPlan, roomId: string): { occupied: number; capacity: number } {
  const roomSeats = seatsForRoom(plan, roomId)
  const occupied = roomSeats.filter((s) => s.studentId !== null).length
  return { occupied, capacity: roomSeats.length }
}

/** Build exam slots from the exam's schedule items (unique date+time combos). */
export function buildExamSlots(exam: { schedule: Array<{ date: string; startTime: string; endTime: string }> }): Array<{ id: string; date: string; startTime: string; endTime: string; shiftLabel: string }> {
  const seen = new Map<string, { id: string; date: string; startTime: string; endTime: string; shiftLabel: string }>()
  let shiftIdx = 0
  for (const item of exam.schedule) {
    const key = `${item.date}-${item.startTime}`
    if (!seen.has(key)) {
      const dateShifts = Array.from(seen.values()).filter((s) => s.date === item.date).length
      const shiftLabel = dateShifts === 0 ? '1st Shift' : '2nd Shift'
      seen.set(key, { id: `slot-${shiftIdx++}`, date: item.date, startTime: item.startTime, endTime: item.endTime, shiftLabel })
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
}
