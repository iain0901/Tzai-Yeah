import type { Ticket } from './tickets.mjs';
export function drawTicket(ticket: Ticket, documentObject?: Document): string;
export function printTickets(tickets: readonly Ticket[], options?: { fetcher?: typeof fetch; render?: (ticket: Ticket) => string | Promise<string>; shouldStop?: () => boolean; onProgress?: (p: {complete:number;total:number;current:string|null}) => void }): Promise<{complete:number;total:number;stopped:boolean}>;
