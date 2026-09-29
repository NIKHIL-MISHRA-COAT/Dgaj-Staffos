import { Metadata } from 'next';
import ExpenseCentre from './components/ExpenseCentre';

export const metadata: Metadata = {
  title: 'Expense Centre | DGaj Connect',
  description: 'Submit and track expense reimbursements',
};

export default function ExpenseCentrePage() {
  return (
          <ExpenseCentre />
    
  );
}
