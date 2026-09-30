export { useSchoolSettingsStore } from './store'
export {
  syncSchoolSettingsFromServer,
  resetSchoolSettingsSyncGuard,
  applySchoolConfig,
  type SchoolSettingsConfig,
} from './server-sync'
export { deriveFeeHeadKind } from './types'
export type {
  ClassConfig,
  SubjectConfig,
  BookItem,
  UniformItem,
  FeeHeadConfig,
  FeeHeadKind,
  DiscountConfig,
  PayGradeConfig,
  TransportRouteConfig,
  HouseConfig,
  AdmissionFormFieldRule,
  AdmissionFeatureFlags,
  AdmissionDocRequirement,
  AdmissionDocumentPolicy,
  ClassSeatConfig,
  DuplicateDetectionConfig,
  WaiverAuditEntry,
  SchoolSettingsState,
  ServerSchoolIdentity,
  ServerSchoolBranding,
  ServerSchoolConfigState,
  ServerSettingsSyncStatus,
} from './types'
