import { Metadata } from 'next';
import TicketCentre from './components/TicketCentre';

export const metadata: Metadata = {
  title: 'Ticket Centre | DGaj Connect',
  description: 'Raise and track internal support tickets',
};

export default function TicketCentrePage() {
  return (
          <TicketCentre />
    
  );
}
