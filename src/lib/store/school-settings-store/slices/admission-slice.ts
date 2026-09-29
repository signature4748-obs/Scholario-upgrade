import type { StateCreator } from 'zustand'
import type { SchoolSettingsState } from '../types'

export const createAdmissionSlice: StateCreator<
  SchoolSettingsState,
  [],
  [],
  Pick<
    SchoolSettingsState,
    | 'updateAdmissionSettings'
    | 'updateAdmissionFeatureFlags'
    | 'updateAdmissionDocumentPolicy'
    | 'updateSeatCapacity'
    | 'updateDuplicateDetection'
    | 'addWaiverAudit'
  >
> = (set) => ({
  updateAdmissionSettings: (data) =>
    set((state) => ({
      admissionSettings: { ...state.admissionSettings, ...data },
    })),

  updateAdmissionFeatureFlags: (data) =>
    set((state) => ({
      admissionSettings: {
        ...state.admissionSettings,
        featureFlags: { ...state.admissionSettings.featureFlags, ...data },
      },
    })),

  updateAdmissionDocumentPolicy: (policy) =>
    set((state) => ({
      admissionSettings: {
        ...state.admissionSettings,
        documentPolicy: { ...policy },
      },
    })),

  updateSeatCapacity: (className, data) =>
    set((state) => ({
      admissionSettings: {
        ...state.admissionSettings,
        seatCapacity: state.admissionSettings.seatCapacity.map((c) =>
          c.className === className ? { ...c, ...data } : c
        ),
      },
    })),

  updateDuplicateDetection: (data) =>
    set((state) => ({
      admissionSettings: {
        ...state.admissionSettings,
        duplicateDetection: { ...state.admissionSettings.duplicateDetection, ...data },
      },
    })),

  addWaiverAudit: (entry) =>
    set((state) => ({
      admissionSettings: {
        ...state.admissionSettings,
        waiverAudit: [
          {
            ...entry,
            id: `waiver-${Date.now()}`,
            timestamp: new Date().toISOString(),
          },
          ...state.admissionSettings.waiverAudit,
        ],
      },
    })),
})
