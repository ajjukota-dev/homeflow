/** @homeflow/ui — the shared frontend package (technical/09 §1). */
export { api, createClient, ApiError, toApiError, onUnauthenticated, get, post, patch, del } from "./api/client";
export type { ApiErrorShape } from "./api/client";
export { uploadFile, downscaleImage, MAX_IMAGE_EDGE_PX } from "./api/upload";
export type { UploadRequest, UploadedFile, PresignResponse } from "./api/upload";

export { SessionProvider, useSession, hasRole } from "./auth/session";
export type { Session, SessionState, Realm } from "./auth/session";
export { SignInGate } from "./auth/SignInGate";
export { RequireRole } from "./auth/RequireRole";
export { StaffSignIn, DEV_USERS } from "./auth/StaffSignIn";
export { CustomerSignIn } from "./auth/CustomerSignIn";

export { useQuery, invalidate, clearCache } from "./query/useQuery";
export type { QueryResult } from "./query/useQuery";

export { Async } from "./states/Async";

export { Button } from "./components/Button";
export { Field } from "./components/Field";
export { Table } from "./components/Table";
export type { Column } from "./components/Table";
export { Skeleton, SkeletonTable } from "./components/Skeleton";
export { EmptyState } from "./components/EmptyState";
export { ErrorState } from "./components/ErrorState";
export { StatusChip } from "./components/StatusChip";
export type { Tone } from "./components/StatusChip";
export { GateChip, GATE_STATES } from "./components/GateChip";
export type { GateState } from "./components/GateChip";
export { Money } from "./components/Money";
export { DateText } from "./components/DateText";

export { inr, inrFull, indianDigits, date, dateTime, relativeTime } from "./format";

/** Generated from the running API by `npm run gen:api`; committed, CI fails if stale. */
export type { paths, components, operations } from "./api/types";
