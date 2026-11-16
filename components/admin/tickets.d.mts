import type { Participant, Card } from "@/lib/contracts";
export type Ticket = { name: string; number: string; url: string };
export function prepareTickets(people: readonly Participant[], origin: string, cards: readonly Card[]): Ticket[];
