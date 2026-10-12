'use client'

import { Shield, X } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { DatePicker } from '@/components/ui/date-picker'
import { AadhaarInput, PhoneInput, EmailInput } from '@/components/shared/smart-inputs'
import type { AddTeacherForm } from './add-teacher-data'

type SetF = (key: string, val: any) => void

interface StepProps {
  form: AddTeacherForm
  setF: SetF
}

/* ---------- STEP 1: Basic Information ----------
 * No h3 heading — StepHeader already shows the title. Single grid + section
 * divider for address. Placeholders + hints follow Admissions convention.
 */
export function Step1BasicInfo({ form, setF }: StepProps) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        <div>
          <Label className="text-xs font-semibold">Full Name</Label>
          <Input value={form.name} onChange={(e) => setF('name', e.target.value)} placeholder="e.g. Aniket Sharma" className="mt-1.5 h-10" />
        </div>
        <div>
          <Label className="text-xs font-semibold">Gender</Label>
          <Select value={form.gender} onValueChange={(v) => setF('gender', v)}>
            <SelectTrigger className="mt-1.5 h-10"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="Male">Male</SelectItem><SelectItem value="Female">Female</SelectItem></SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs font-semibold">Date of Birth</Label>
          <DatePicker value={form.dob} onChange={(v) => setF('dob', v)} placeholder="Select birth date" className="mt-1.5" />
        </div>
        <div>
          <Label className="text-xs font-semibold">Blood Group</Label>
          <Input value={form.bloodGroup} onChange={(e) => setF('bloodGroup', e.target.value)} placeholder="e.g. B+" className="mt-1.5 h-10" />
        </div>
        <div>
          <Label className="text-xs font-semibold">Aadhaar / Govt ID</Label>
          <AadhaarInput value={form.aadhaarNo} onChange={(v) => setF('aadhaarNo', v)} placeholder="12-digit Aadhaar" className="mt-1.5" />
        </div>
        <div>
          <Label className="text-xs font-semibold">Email Address</Label>
          <EmailInput value={form.email} onChange={(v) => setF('email', v)} placeholder="e.g. aniket.sharma@school.edu" className="mt-1.5" />
        </div>
        <div>
          <Label className="text-xs font-semibold">Phone Number</Label>
          <PhoneInput value={form.phone} onChange={(v) => setF('phone', v)} placeholder="e.g. 98765 43210" className="mt-1.5" />
        </div>
        <div>
          <Label className="text-xs font-semibold">Emergency Contact Person</Label>
          <Input value={form.emergencyName} onChange={(e) => setF('emergencyName', e.target.value)} placeholder="e.g. Sanjay Sharma" className="mt-1.5 h-10" />
        </div>
        <div>
          <Label className="text-xs font-semibold">Emergency Phone</Label>
          <PhoneInput value={form.emergencyPhone} onChange={(v) => setF('emergencyPhone', v)} placeholder="e.g. 98765 00000" className="mt-1.5" />
        </div>
      </div>

      <div className="pt-3 border-t border-border">
        <p className="text-xs font-bold text-primary mb-3 uppercase tracking-wider">Residential Address</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <div className="sm:col-span-2">
            <Label className="text-xs font-semibold">Address Line</Label>
            <Input value={form.currentAddress} onChange={(e) => setF('currentAddress', e.target.value)} placeholder="House no, street, area" className="mt-1.5 h-10" />
          </div>
          <div>
            <Label className="text-xs font-semibold">District</Label>
            <Input value={form.district} onChange={(e) => setF('district', e.target.value)} placeholder="e.g. Gurugram" className="mt-1.5 h-10" />
          </div>
          <div>
            <Label className="text-xs font-semibold">State</Label>
            <Input value={form.state} onChange={(e) => setF('state', e.target.value)} placeholder="e.g. Haryana" className="mt-1.5 h-10" />
          </div>
          <div>
            <Label className="text-xs font-semibold">PIN Code</Label>
            <Input value={form.pincode} onChange={(e) => setF('pincode', e.target.value)} placeholder="e.g. 122001" className="mt-1.5 h-10" />
          </div>
          <div>
            <Label className="text-xs font-semibold">Country</Label>
            <Input value="India" readOnly disabled className="mt-1.5 h-10 bg-muted/50 cursor-not-allowed text-muted-foreground" />
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- STEP 2: Qualifications & Experience ---------- */
export function Step2Qualifications({ form, setF }: StepProps) {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-bold text-primary mb-3 uppercase tracking-wider">Education</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          <div>
            <Label className="text-xs font-semibold">Highest Degree</Label>
            <Input value={form.degree} onChange={(e) => setF('degree', e.target.value)} placeholder="e.g. M.Sc. Mathematics" className="mt-1.5 h-10" />
          </div>
          <div>
            <Label className="text-xs font-semibold">Specialization</Label>
            <Input value={form.specialization} onChange={(e) => setF('specialization', e.target.value)} placeholder="e.g. Pure Mathematics" className="mt-1.5 h-10" />
          </div>
          <div>
            <Label className="text-xs font-semibold">University / Institution</Label>
            <Input value={form.institution} onChange={(e) => setF('institution', e.target.value)} placeholder="e.g. Delhi University" className="mt-1.5 h-10" />
          </div>
          <div>
            <Label className="text-xs font-semibold">Professional Certifications</Label>
            <Input value={form.profQualifications} onChange={(e) => setF('profQualifications', e.target.value)} placeholder="e.g. B.Ed, CTET Paper II" className="mt-1.5 h-10" />
          </div>
        </div>
      </div>

      <div className="pt-3 border-t border-border">
        <p className="text-xs font-bold text-primary mb-3 uppercase tracking-wider">Experience</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          <div>
            <Label className="text-xs font-semibold">Total Experience (Years)</Label>
            <Input type="number" min={0} value={form.totalExperience || ''} onChange={(e) => setF('totalExperience', parseInt(e.target.value) || 0)} placeholder="e.g. 7" className="mt-1.5 h-10" />
          </div>
          <div>
            <Label className="text-xs font-semibold">Previous School / Organization</Label>
            <Input value={form.prevOrg} onChange={(e) => setF('prevOrg', e.target.value)} placeholder="e.g. DAP Public School" className="mt-1.5 h-10" />
          </div>
          <div>
            <Label className="text-xs font-semibold">Previous Designation</Label>
            <Input value={form.prevDesignation} onChange={(e) => setF('prevDesignation', e.target.value)} placeholder="e.g. Math Teacher" className="mt-1.5 h-10" />
          </div>
          <div>
            <Label className="text-xs font-semibold">Previous Salary (₹)</Label>
            <Input type="number" min={0} value={form.prevSalary || ''} onChange={(e) => setF('prevSalary', parseInt(e.target.value) || 0)} placeholder="e.g. 50000" className="mt-1.5 h-10" />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs font-semibold">Key Achievements</Label>
            <Input value={form.keyAchievements} onChange={(e) => setF('keyAchievements', e.target.value)} placeholder="e.g. State Mathematics Quiz Coordinator 2023" className="mt-1.5 h-10" />
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- STEP 3: Appointment & Salary ---------- */
export function Step3Appointment({ form, setF }: StepProps) {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-bold text-primary mb-3 uppercase tracking-wider">Joining</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          <div>
            <Label className="text-xs font-semibold">Date of Joining</Label>
            <DatePicker value={form.joiningDate} onChange={(v) => setF('joiningDate', v)} placeholder="Select joining date" className="mt-1.5" />
          </div>
          <div>
            <Label className="text-xs font-semibold">Employment Type</Label>
            <Select value={form.employmentType} onValueChange={(v) => setF('employmentType', v)}>
              <SelectTrigger className="mt-1.5 h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Full Time">Full Time</SelectItem>
                <SelectItem value="Probation">Probation</SelectItem>
                <SelectItem value="Part Time">Part Time</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-semibold">Gross Monthly Salary (₹)</Label>
            <Input type="number" min={0} value={form.salary || ''} onChange={(e) => setF('salary', parseInt(e.target.value) || 0)} placeholder="e.g. 68000" className="mt-1.5 h-10" />
          </div>
        </div>
      </div>

      <div className="pt-3 border-t border-border">
        <p className="text-xs font-bold text-primary mb-3 uppercase tracking-wider">Bank Details</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          <div>
            <Label className="text-xs font-semibold">Bank Name</Label>
            <Input value={form.bankName} onChange={(e) => setF('bankName', e.target.value)} placeholder="e.g. HDFC Bank" className="mt-1.5 h-10" />
          </div>
          <div>
            <Label className="text-xs font-semibold">Account Number</Label>
            <Input value={form.accountNo} onChange={(e) => setF('accountNo', e.target.value)} placeholder="e.g. 50100482910394" className="mt-1.5 h-10" />
          </div>
          <div>
            <Label className="text-xs font-semibold">IFSC Code</Label>
            <Input value={form.ifscCode} onChange={(e) => setF('ifscCode', e.target.value.toUpperCase().slice(0, 11))} placeholder="e.g. HDFC0000123" className="mt-1.5 h-10 uppercase font-mono" />
          </div>
          <div>
            <Label className="text-xs font-semibold">Branch Name</Label>
            <Input value={form.branchName} onChange={(e) => setF('branchName', e.target.value)} placeholder="e.g. Sector 15 Gurugram" className="mt-1.5 h-10" />
          </div>
        </div>
      </div>
    </div>
  )
}

interface Step4Props extends StepProps {
  availableInchargePositions: string[]
  classOptions: string[]
  classesWithClassTeacher: Set<string>
  classesWithAsstClassTeacher: Set<string>
  subjectList: string[]
  toggleClass: (cls: string) => void
  toggleSubject: (sub: string) => void
}

/* ---------- STEP 4: Academic Assignment ---------- */
export function Step4Academic({
  form, setF,
  availableInchargePositions, classOptions,
  classesWithClassTeacher, classesWithAsstClassTeacher,
  subjectList, toggleClass, toggleSubject,
}: Step4Props) {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-bold text-primary mb-3 uppercase tracking-wider flex items-center gap-1.5">
          <Shield className="h-3.5 w-3.5" /> Responsibility & Position Assignments
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          <div>
            <Label className="text-xs font-semibold">Incharge Position</Label>
            <Select value={form.inchargePosition} onValueChange={(v) => setF('inchargePosition', v)}>
              <SelectTrigger className="mt-1.5 h-10"><SelectValue placeholder="Select incharge" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="None">None</SelectItem>
                {availableInchargePositions.map((pos) => (
                  <SelectItem key={pos} value={pos}>{pos}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-semibold">Class Teacher Role</Label>
            <Select value={form.classTeacherRole} onValueChange={(v) => setF('classTeacherRole', v)}>
              <SelectTrigger className="mt-1.5 h-10"><SelectValue placeholder="Select class" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="None">None</SelectItem>
                {classOptions.map((cls) => {
                  const isTaken = classesWithClassTeacher.has(cls)
                  return (
                    <SelectItem key={cls} value={cls} disabled={isTaken}>
                      {cls} {isTaken ? '(Assigned)' : ''}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-semibold">Assistant Class Teacher</Label>
            <Select value={form.assistantClassTeacherRole} onValueChange={(v) => setF('assistantClassTeacherRole', v)}>
              <SelectTrigger className="mt-1.5 h-10"><SelectValue placeholder="Select class" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="None">None</SelectItem>
                {classOptions.map((cls) => {
                  const isTaken = classesWithAsstClassTeacher.has(cls)
                  return (
                    <SelectItem key={cls} value={cls} disabled={isTaken}>
                      {cls} {isTaken ? '(Assigned)' : ''}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="pt-3 border-t border-border">
        <p className="text-xs font-bold text-primary mb-3 uppercase tracking-wider">Classes & Subjects</p>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs font-semibold">Classes ({form.selectedClasses.length})</Label>
            <Select onValueChange={(v) => { if (v && !form.selectedClasses.includes(v)) toggleClass(v) }}>
              <SelectTrigger className="h-10"><SelectValue placeholder="Add class..." /></SelectTrigger>
              <SelectContent>
                {classOptions.filter((cls) => !form.selectedClasses.includes(cls)).map((cls) => (
                  <SelectItem key={cls} value={cls}>{cls}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.selectedClasses.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {form.selectedClasses.map((cls) => (
                  <span key={cls} className="inline-flex items-center gap-1 rounded-md bg-primary/10 text-primary px-2 py-1 text-xs font-medium">
                    {cls}
                    <button type="button" onClick={() => toggleClass(cls)} className="hover:text-destructive"><X className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold">Subjects ({form.selectedSubjects.length})</Label>
            <Select onValueChange={(v) => { if (v && !form.selectedSubjects.includes(v)) toggleSubject(v) }}>
              <SelectTrigger className="h-10"><SelectValue placeholder="Add subject..." /></SelectTrigger>
              <SelectContent>
                {subjectList.filter((sub) => !form.selectedSubjects.includes(sub)).map((sub) => (
                  <SelectItem key={sub} value={sub}>{sub}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.selectedSubjects.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {form.selectedSubjects.map((sub) => (
                  <span key={sub} className="inline-flex items-center gap-1 rounded-md bg-primary/10 text-primary px-2 py-1 text-xs font-medium">
                    {sub}
                    <button type="button" onClick={() => toggleSubject(sub)} className="hover:text-destructive"><X className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="pt-3 border-t border-border">
        <Label className="text-xs font-semibold">Remarks</Label>
        <Textarea value={form.remarks} onChange={(e) => setF('remarks', e.target.value)} placeholder="Optional notes about interview, references, etc." className="mt-1.5 min-h-[60px]" />
      </div>
    </div>
  )
}
