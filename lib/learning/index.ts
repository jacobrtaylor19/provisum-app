/** Barrel re-export for the learning loop (B4). */

export type {
  CanonicalPersonRecordJson,
  CorrectionRecord,
  EngineOutput,
  HumanDecision,
  VerificationStatus,
} from "./correction-record";
export {
  CORRECTION_SCHEMA_VERSION,
  buildCorrectionRecord,
  diffEngineVsHuman,
} from "./correction-record";

export type {
  CanonicalSnapshot,
  CorrectionRetrievalQuery,
  CorrectionStore,
  MappingFeedbackRow,
} from "./correction-reader";
export { feedbackToCorrection, makeInMemoryCorrectionStore } from "./correction-reader";
