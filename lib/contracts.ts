export type EventPhase = "before" | "live" | "after";
export type ProfileMode = "page" | "redirect";
export interface GalleryPhoto { url: string; caption: string }
export interface EventConfig {
  title: string;
  subtitle: string;
  theme: string;
  date: string;
  doors: string;
  start: string;
  end: string;
  venue: string;
  address: string;
  phase: EventPhase;
  revealOpen: boolean;
  videoUrl: string;
  albumUrl: string;
  welcome: string;
  afterMessage: string;
  gallery: GalleryPhoto[];
  publishedAt: string | null;
  publishedVersion: number;
}
export interface Group { id: string; name: string; location: string; note: string; color: string }
export interface Profile { displayName: string; bio: string; url: string; mode: ProfileMode }
export interface PublicCard {
  serial: string;
  headerName: string;
  active: boolean;
  bound: boolean;
  group: Group | null;
  profile: Profile;
  claimed: boolean;
}
export interface PublicEventData { event: EventConfig; card: PublicCard | null }
export interface Participant {
  id: string;
  name: string;
  house: string;
  householdNumber: number | null;
  groupId: string | null;
  cardId: string | null;
  checkedInAt: string | null;
  claimed: boolean;
  hasClaimCode: boolean;
  profile: Profile | null;
  url: string | null;
  linkActive: boolean;
}
export interface Card {
  id: string;
  serial: string;
  token: string;
  url: string;
  active: boolean;
  participantId: string | null;
  createdAt: string;
}
export interface UserIdentity { id: string; email: string; name: string; role?: "admin" | "member" }
export interface AuditEntry { id: string; actor: string; action: string; detail: string; createdAt: string }
export interface AdminData {
  event: EventConfig;
  cards: Card[];
  participants: Participant[];
  groups: Group[];
  stats: { cards: number; participants: number; bound: number; grouped: number; checkedIn: number; published: number };
  user: UserIdentity;
  audit: AuditEntry[];
}
export interface MeData {
  user: UserIdentity | null;
  /** Legacy account claim status; card-link editing does not depend on it. */
  isOwner: boolean;
  canEdit: boolean;
  serial: string;
  bound: boolean;
  profile: Profile | null;
}
export interface ActionResult { ok: true; message: string; code?: string; count?: number; url?: string; participantId?: string; cardId?: string; created?: boolean }
export interface ApiError { error: string; code: string }
export type AdminAction =
  | { action: "saveEvent"; event: Partial<EventConfig> }
  | { action: "generateCards"; count?: number }
  | { action: "ensureParticipantLink"; participantId: string }
  | { action: "saveGroup"; id?: string; name: string; location?: string; note?: string; color?: string }
  | { action: "deleteGroup"; id: string }
  | { action: "saveParticipant"; id?: string; name: string; house?: string; householdNumber?: number | null; groupId?: string | null; cardId?: string | null }
  | { action: "importParticipants"; rows: Array<{ name: string; house?: string; householdNumber?: number | null; groupId?: string | null; cardSerial?: string }> }
  | { action: "publishGroups" }
  | { action: "setCardActive"; cardId: string; active: boolean }
  | { action: "checkIn"; participantId: string; checkedIn?: boolean }
  | { action: "issueClaimCode"; participantId: string; resetOwner?: boolean };
