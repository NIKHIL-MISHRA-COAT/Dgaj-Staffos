-- DGaj Connect: Pre-loaded Workflow Tasks from Work_Flow PDF
-- Tasks are seeded as templates for the Director to assign to users

-- Add assigned_to_user_id column if not already present (for specific user assignment)
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS assigned_to_user_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS is_template boolean DEFAULT false;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS task_category text DEFAULT 'general';

CREATE INDEX IF NOT EXISTS idx_tasks_is_template ON public.tasks(is_template);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to_user_id ON public.tasks(assigned_to_user_id);

-- Seed Daily Tasks (templates, unassigned, for Director to assign)
DO $$
BEGIN
  -- Only seed if no templates exist yet
  IF NOT EXISTS (SELECT 1 FROM public.tasks WHERE is_template = true LIMIT 1) THEN

    -- ============================================================
    -- DAILY TASKS
    -- ============================================================

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Daily Portal Balance Update – Groups + Excel.',
      'Update all portal balances for groups and record in Excel daily.',
      'high', 'todo', true, 'daily',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[]'::jsonb,
      ARRAY['daily', 'portal', 'excel']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Receipt of Challans from respective sites.',
      'Collect and receive challans from all respective fuel station sites.',
      'high', 'todo', true, 'daily',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[]'::jsonb,
      ARRAY['daily', 'challans']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Entry of Challans into Vyapaar app.',
      'Enter all received challans into the Vyapaar application.',
      'high', 'todo', true, 'daily',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[]'::jsonb,
      ARRAY['daily', 'vyapaar', 'challans']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Conversion of Challans into Sale invoices in Vyapaar.',
      'Convert all entered challans into sale invoices within the Vyapaar app.',
      'high', 'todo', true, 'daily',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[]'::jsonb,
      ARRAY['daily', 'vyapaar', 'invoices']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Entry of Invoices in Tally with Narration.',
      'Enter all sale invoices into Tally software with proper narration.',
      'high', 'todo', true, 'daily',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[]'::jsonb,
      ARRAY['daily', 'tally', 'invoices']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Downloading Challans Made as well Invoice Made and Saving them in files.',
      'Download all challans and invoices created and save them in the appropriate files.',
      'medium', 'todo', true, 'daily',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[]'::jsonb,
      ARRAY['daily', 'challans', 'invoices', 'filing']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Entering Bank Transactions and Statements in Tally – SBI / UBI / IB.',
      'Enter all bank transactions and statements for SBI, UBI, and IB accounts into Tally.',
      'high', 'todo', true, 'daily',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[]'::jsonb,
      ARRAY['daily', 'tally', 'bank', 'SBI', 'UBI', 'IB']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Entering Portal Transactions and Statements in Tally – HPCL /BPCL Creditor.',
      'Enter all portal transactions and statements for HPCL and BPCL creditors into Tally.',
      'high', 'todo', true, 'daily',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[]'::jsonb,
      ARRAY['daily', 'tally', 'HPCL', 'BPCL', 'portal']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Entry of Purchases made from company.',
      'Record all purchases made from the company into the system.',
      'high', 'todo', true, 'daily',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[]'::jsonb,
      ARRAY['daily', 'purchases']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Saving Purchase Invoices in files – PDF format.',
      'Save all purchase invoices in PDF format in the appropriate files.',
      'medium', 'todo', true, 'daily',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[]'::jsonb,
      ARRAY['daily', 'purchases', 'invoices', 'PDF']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Checking Payment Received from Parties and not over/under-recorded.',
      'Verify all payments received from parties and ensure they are not over or under-recorded.',
      'high', 'todo', true, 'daily',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[]'::jsonb,
      ARRAY['daily', 'payments', 'verification']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Sending Sale invoices with challans to respective parties through mail of respective firm.',
      'Send sale invoices along with challans to respective parties via email from the respective firm email.',
      'high', 'todo', true, 'daily',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[]'::jsonb,
      ARRAY['daily', 'invoices', 'challans', 'email']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Sending intimation of payment received with payment mode to respective parties through mail of respective firm.',
      'Send payment receipt intimation including payment mode to respective parties via email from the respective firm email.',
      'high', 'todo', true, 'daily',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[]'::jsonb,
      ARRAY['daily', 'payments', 'email', 'intimation']
    );

    -- ============================================================
    -- EXCEL DAILY TASKS
    -- ============================================================

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Stock Sheet',
      'Daily entry and maintenance of the Stock Sheet in Excel.',
      'high', 'todo', true, 'daily-excel',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[
        {"id": "ss-a", "text": "Entry of Daily Sale in litres.", "done": false},
        {"id": "ss-b", "text": "Entry of Daily Stock in litres.", "done": false},
        {"id": "ss-c", "text": "Entry of Daily Purchase in litres.", "done": false},
        {"id": "ss-d", "text": "Entry of Day Variation in litres.", "done": false}
      ]'::jsonb,
      ARRAY['daily', 'excel', 'stock']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Tank Stock Sheet',
      'Daily entry and maintenance of the Tank Stock Sheet in Excel.',
      'high', 'todo', true, 'daily-excel',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[
        {"id": "tss-a", "text": "Entry of Tank Stock with Dip in millilitres and Litres.", "done": false}
      ]'::jsonb,
      ARRAY['daily', 'excel', 'tank', 'stock']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Nozzle Reading Sheet',
      'Daily entry and maintenance of the Nozzle Reading Sheet in Excel.',
      'high', 'todo', true, 'daily-excel',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[
        {"id": "nrs-a", "text": "Entry of Nozzle Readings – Closing Balance of Everyday. Only Opening Balance on Year Start", "done": false}
      ]'::jsonb,
      ARRAY['daily', 'excel', 'nozzle']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Expenses Sheet',
      'Daily entry and maintenance of the Expenses Sheet in Excel.',
      'high', 'todo', true, 'daily-excel',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[
        {"id": "es-a", "text": "Entry of Expenses with mode of payment of Expense. Flag Daily Expenses if Exceeding any limiters.", "done": false},
        {"id": "es-b", "text": "Cash Expense total to be separated for future purposes. Other modes to be segregated as well.", "done": false},
        {"id": "es-c", "text": "Any and all Expenses (apart from Grocery/Ration) bills required. Bill to be received online and to be told to store physical copy at fuel station and digital copy at office.", "done": false},
        {"id": "es-d", "text": "If no bill received, the bill is to be flagged for discrepancies and issue to be raised.", "done": false}
      ]'::jsonb,
      ARRAY['daily', 'excel', 'expenses']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Purchase Sheet',
      'Daily entry and maintenance of the Purchase Sheet in Excel.',
      'high', 'todo', true, 'daily-excel',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[
        {"id": "ps-a", "text": "Entry of Purchase invoice with all details – Price / VAT / Surcharge / CESS / SSLF.", "done": false},
        {"id": "ps-b", "text": "Invoice of Purchase to be saved in office daily. Digital Copy in respective folder of respective firm in respective period.", "done": false}
      ]'::jsonb,
      ARRAY['daily', 'excel', 'purchase']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Revenue for Day Sheet',
      'Daily entry and maintenance of the Revenue for Day Sheet in Excel.',
      'high', 'todo', true, 'daily-excel',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[
        {"id": "rds-a", "text": "Add Details from cash flow statement regarding sale of fuel and mode of payments fuel wise.", "done": false},
        {"id": "rds-b", "text": "Put it heading-wise in MS/ HSD/CNG /Power/Speed based on amount from Cash Sale/Credit Sale/ Card Machine Sale/ PhonePe or PayTM Sale.", "done": false},
        {"id": "rds-c", "text": "Get Total Revenue for Day. This to be matched with day Revenue in Stock sheet. Flagged in case of discrepancy.", "done": false},
        {"id": "rds-d", "text": "Get total Cash Collected for Day.", "done": false}
      ]'::jsonb,
      ARRAY['daily', 'excel', 'revenue']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Bank – Cash Flow',
      'Daily entry and maintenance of the Bank – Cash Flow Sheet in Excel.',
      'high', 'todo', true, 'daily-excel',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[
        {"id": "bcf-a", "text": "Add Total Cash Collected for Day from Revenue for Day Sheet and add in Day Cash Sale Receipts column.", "done": false},
        {"id": "bcf-b", "text": "Entry of Bank Deposits made on Said date which is to be cross checked with bank statement and flagged if any discrepancies arise.", "done": false},
        {"id": "bcf-c", "text": "Entry of Cash Expenses based on total of all expenses paid through cash", "done": false},
        {"id": "bcf-d", "text": "Other inward and outward flow of cash to be justified with statement and Note. If no Note is provided to be questioned and flagged.", "done": false},
        {"id": "bcf-e", "text": "Balance of Net Cash in hand to be matched with Capital A/C sheet", "done": false}
      ]'::jsonb,
      ARRAY['daily', 'excel', 'bank', 'cash-flow']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Challan Sheet',
      'Daily entry and maintenance of the Challan Sheet in Excel.',
      'high', 'todo', true, 'daily-excel',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[
        {"id": "cs-a", "text": "HSD / Petrol /CNG Challans to be added with name of Purchaser, Vehicle Number, Item Sold, Quantity, Price/ Rate and Amount.", "done": false},
        {"id": "cs-b", "text": "If Purchaser takes Lubes and oils, it is also to be added with appropriate details.", "done": false},
        {"id": "cs-c", "text": "On Cash Bills Details to be added for easy entry in Vyapaar. Add the letter \"C\" in Note of Said challan.", "done": false}
      ]'::jsonb,
      ARRAY['daily', 'excel', 'challan']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Credit Sheet – Sundry Debtors',
      'Daily entry and maintenance of the Credit Sheet – Sundry Debtors in Excel.',
      'high', 'todo', true, 'daily-excel',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[
        {"id": "csd-a", "text": "Total Day Challan details to be added depending on customer – litres purchased, purchase amount (discount to be deducted; e.g. = 90 – 1 = Rs. 89) to be added daily to Credit Party Purchase Amount.", "done": false},
        {"id": "csd-b", "text": "Receipt Amount to be entered as well.", "done": false},
        {"id": "csd-c", "text": "Additional entries of other sales like cash or lubes and oils sale to be added.", "done": false},
        {"id": "csd-d", "text": "When balance for respective party is found, it is to be matched with data provided from site manager and to be notified for discrepancies to respective managers.", "done": false},
        {"id": "csd-e", "text": "Confirm total", "done": false}
      ]'::jsonb,
      ARRAY['daily', 'excel', 'credit', 'debtors']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Capital Sheet',
      'Daily entry and maintenance of the Capital Sheet in Excel.',
      'high', 'todo', true, 'daily-excel',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[
        {"id": "cap-a", "text": "Entry of HPCL / BPCL Portal balances in sheet with bifurcation for fuels MS/HSD, Lubes and Natural Gas.", "done": false},
        {"id": "cap-b", "text": "Entry of Sundry debtors or credit parties balance total in the capital sheet.", "done": false},
        {"id": "cap-c", "text": "Stock of each respective fuel to be multiplied by Stock purchase value to get Stock Value of each fuel and Stock of lubes to be maintained everyday.", "done": false},
        {"id": "cap-d", "text": "Add daily bank closing balance.", "done": false},
        {"id": "cap-e", "text": "Get Daily Net Capital from Formula and Notify in case it causes any discrepancy in limiters.", "done": false}
      ]'::jsonb,
      ARRAY['daily', 'excel', 'capital']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Lubes and Oils Sheet',
      'Daily entry and maintenance of the Lubes and Oils Sheet in Excel.',
      'medium', 'todo', true, 'daily-excel',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[
        {"id": "lo-a", "text": "Fill details – Name of customer, Product, Quantity, Price, GST and Payment Mode.", "done": false}
      ]'::jsonb,
      ARRAY['daily', 'excel', 'lubes', 'oils']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Receipts Sheet',
      'Daily entry and maintenance of the Receipts Sheet in Excel.',
      'high', 'todo', true, 'daily-excel',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[
        {"id": "rs-a", "text": "Receipts to be taken from data with Party Name, amount and Mode of Payment.", "done": false},
        {"id": "rs-b", "text": "This Receipt to be cross verified in respective mode of payment and flagged if any discrepancies arise.", "done": false}
      ]'::jsonb,
      ARRAY['daily', 'excel', 'receipts']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Logistics Sheet',
      'Daily entry and maintenance of the Logistics Sheet in Excel.',
      'medium', 'todo', true, 'daily-excel',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[
        {"id": "ls-a", "text": "To Fill daily expenses with Particulars and getting cumulative expenses.", "done": false},
        {"id": "ls-b", "text": "To Fill income in Different sources by getting from HPCL/BPCL Transport Portal divided into two sources which is observed on 15th every month: Income in Bank, Income in Card, Toll Payments Reimbursements", "done": false},
        {"id": "ls-c", "text": "The invoice to for these income receipts and expense payments to be saved.", "done": false},
        {"id": "ls-d", "text": "Expenses to be flagged based on limiters.", "done": false},
        {"id": "ls-e", "text": "No receipt of payment in bank A/C to be flagged as well. Card payment to be confirmed with card portal.", "done": false}
      ]'::jsonb,
      ARRAY['daily', 'excel', 'logistics']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Cash Flow Excel to be filled with data of money between the three companies with date, mode of transfer and From / To.',
      'Fill the Cash Flow Excel with intercompany money transfer data including date, mode of transfer, and From/To details.',
      'high', 'todo', true, 'daily-excel',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[]'::jsonb,
      ARRAY['daily', 'excel', 'cash-flow', 'intercompany']
    );

    -- ============================================================
    -- MONTHLY TASKS
    -- ============================================================

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Finalising all entries for the month for bank accounts and portal balances and matching closing balances in Tally – SBI / UBI / IB – HPCL /BPCL Creditor.',
      'Finalise all monthly entries for bank accounts and portal balances and match closing balances in Tally for SBI, UBI, IB, HPCL, and BPCL Creditor.',
      'critical', 'todo', true, 'monthly',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[]'::jsonb,
      ARRAY['monthly', 'tally', 'bank', 'portal', 'closing']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Finishing all Journal Entries for the month.',
      'Complete and finalise all journal entries for the month.',
      'critical', 'todo', true, 'monthly',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[]'::jsonb,
      ARRAY['monthly', 'journal', 'tally']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Closing Balance of all Stock to be maintained as well – Lubes & Fuels.',
      'Maintain and record the closing balance of all stock including Lubes and Fuels at month end.',
      'high', 'todo', true, 'monthly',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[]'::jsonb,
      ARRAY['monthly', 'stock', 'closing-balance']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Credit party / Sundry Debtors balances to be finalised matched and a statement to be sent every month to each party on purchases and receipts of payments through mail.',
      'Finalise and match credit party/sundry debtors balances and send monthly statements to each party covering purchases and receipts of payments via email.',
      'high', 'todo', true, 'monthly',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[]'::jsonb,
      ARRAY['monthly', 'debtors', 'statements', 'email']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Tally to be finalised for the month with all respective narrations.',
      'Finalise Tally for the month with all respective narrations entered.',
      'critical', 'todo', true, 'monthly',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[]'::jsonb,
      ARRAY['monthly', 'tally', 'narrations']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Tally Revenue to be matched with Total Revenue for month from PNL Excel.',
      'Match the Tally revenue figures with the total revenue for the month from the PNL Excel sheet.',
      'high', 'todo', true, 'monthly',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[]'::jsonb,
      ARRAY['monthly', 'tally', 'revenue', 'PNL']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Entry of Purchases made from company to be used to make TDS and file for TDS Return.',
      'Enter all company purchases to be used for TDS calculation and filing of TDS Return.',
      'high', 'todo', true, 'monthly',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[]'::jsonb,
      ARRAY['monthly', 'purchases', 'TDS']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Filing of following post finalisation.',
      'File all required returns and compliance documents post monthly finalisation.',
      'critical', 'todo', true, 'monthly',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[
        {"id": "fil-a", "text": "GST 1 = 9th Monthly", "done": false},
        {"id": "fil-b", "text": "GST 3 = 19th Monthly", "done": false},
        {"id": "fil-c", "text": "TDS = 5th Monthly", "done": false},
        {"id": "fil-d", "text": "TDS Returns = Last date of Quarter", "done": false},
        {"id": "fil-e", "text": "PTEC – 15th June = Rs. 2500/-", "done": false},
        {"id": "fil-f", "text": "PTRC – 15th March of following year", "done": false},
        {"id": "fil-g", "text": "GST 9 – Dec 31 Annually for preceding financial year.", "done": false},
        {"id": "fil-h", "text": "AOC 4 – Annually", "done": false},
        {"id": "fil-i", "text": "MGT 7 – Annually", "done": false}
      ]'::jsonb,
      ARRAY['monthly', 'GST', 'TDS', 'PTEC', 'PTRC', 'filing', 'compliance']
    );

    -- ============================================================
    -- MONTHLY EXCEL TASKS
    -- ============================================================

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Profit and Loss Sheet.',
      'Monthly preparation and maintenance of the Profit and Loss Sheet in Excel.',
      'critical', 'todo', true, 'monthly-excel',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[
        {"id": "pnl-a", "text": "Calculate commission based on fuel sold into commission rate per litre.", "done": false},
        {"id": "pnl-b", "text": "Add transport/Logistics income for Bank, Card and toll reimbursement.", "done": false},
        {"id": "pnl-c", "text": "Add transport/ Logistics Expenses – fuel and Toll.", "done": false},
        {"id": "pnl-d", "text": "Add TDS Received and reversal.", "done": false},
        {"id": "pnl-e", "text": "Enter TDS paid.", "done": false},
        {"id": "pnl-f", "text": "Enter Pump Expenses excluding wages", "done": false},
        {"id": "pnl-g", "text": "Enter fuel station wages.", "done": false},
        {"id": "pnl-h", "text": "Enter discount party wise.", "done": false},
        {"id": "pnl-i", "text": "Enter Drawings.", "done": false},
        {"id": "pnl-j", "text": "Enter GST payments made.", "done": false},
        {"id": "pnl-k", "text": "Enter Loyalty Charges Paid from OMC Portal.", "done": false},
        {"id": "pnl-l", "text": "Enter SSLF Paid from OMC Portal.", "done": false},
        {"id": "pnl-m", "text": "Enter EM Lock Charges Paid from OMC Portal.", "done": false},
        {"id": "pnl-n", "text": "Enter Interest Paid from OMC Portal.", "done": false},
        {"id": "pnl-o", "text": "Enter Bank Charges Paid.", "done": false},
        {"id": "pnl-p", "text": "Enter PF / ESIC Paid.", "done": false},
        {"id": "pnl-q", "text": "Enter PTEC / PTRC Paid.", "done": false},
        {"id": "pnl-r", "text": "Enter Electricity Charges.", "done": false},
        {"id": "pnl-s", "text": "Make Stamping Charges.", "done": false}
      ]'::jsonb,
      ARRAY['monthly', 'excel', 'PNL', 'profit-loss']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Expenses Sheet',
      'Monthly entry and reconciliation of the Expenses Sheet in Excel.',
      'high', 'todo', true, 'monthly-excel',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[
        {"id": "mes-a", "text": "Add Expenses from PNL book made by manager as. Match expenses and cross check and tally with daily expenses in terms of entry, amount and mode of payment. In case of discrepancy notify.", "done": false},
        {"id": "mes-b", "text": "Cumulative Expenses of PNL provided should match the total closing balances of month from daily log excel at end of month.", "done": false},
        {"id": "mes-c", "text": "All expenses to be checked with respective invoices and flagged in case of discrepancies in case of no invoice for purchase received (excluding ration)", "done": false}
      ]'::jsonb,
      ARRAY['monthly', 'excel', 'expenses', 'reconciliation']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Capital Sheet',
      'Monthly entry and maintenance of the Capital Sheet in Excel.',
      'high', 'todo', true, 'monthly-excel',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[
        {"id": "mcs-a", "text": "Entry of HPCL / BPCL Portal balances in sheet with bifurcation for fuels MS/HSD, Lubes and Natural Gas from last day of month.", "done": false},
        {"id": "mcs-b", "text": "Entry of Sundry debtors or credit parties balance total in the capital sheet from last day of month.", "done": false},
        {"id": "mcs-c", "text": "Stock of each respective fuel to be multiplied by Stock purchase value to get Stock Value of each fuel and Stock of lubes on month end.", "done": false},
        {"id": "mcs-d", "text": "Add month bank closing balance.", "done": false},
        {"id": "mcs-e", "text": "Get Net Capital from Formula.", "done": false}
      ]'::jsonb,
      ARRAY['monthly', 'excel', 'capital']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Debtors Statement Sheet',
      'Monthly preparation of the Debtors Statement Sheet in Excel.',
      'high', 'todo', true, 'monthly-excel',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[
        {"id": "dss-a", "text": "To be made at month end for credit parties or sundry debtors.", "done": false},
        {"id": "dss-b", "text": "Total month sale to each party in terms of fuel to be added; value to be removed on price with discount (if applicable).", "done": false},
        {"id": "dss-c", "text": "Cash taken to be entered.", "done": false},
        {"id": "dss-d", "text": "Lube Sale to be entered separately.", "done": false},
        {"id": "dss-e", "text": "Receipts for the month to be entered and balance to be removed as per: Opening Balance + (Month Sale ltr x Sale price) + Cash + Lube Sale – Receipts = Closing Balance", "done": false},
        {"id": "dss-f", "text": "Opening balance to be taken as per last year''s closing balance and for each months closing balance to be taken as next month''s opening balance.", "done": false}
      ]'::jsonb,
      ARRAY['monthly', 'excel', 'debtors', 'statement']
    );

    INSERT INTO public.tasks (title, description, priority, status, is_template, task_category, assigned_to_name, assigned_to_dept, assigned_by_name, assigned_by_dept, checklist, tags)
    VALUES (
      'Revenue Statement',
      'Monthly preparation of the Revenue Statement in Excel.',
      'high', 'todo', true, 'monthly-excel',
      'Unassigned', 'Finance', 'Director', 'Management',
      '[
        {"id": "revs-a", "text": "Revenue Statement to be made on month end using total month sale.", "done": false},
        {"id": "revs-b", "text": "It is to be made by multiplying sale volume x sale price of each product.", "done": false},
        {"id": "revs-c", "text": "Products are to be divided into 3 categories: GST Sale, Non GST Sale, VAT Sale", "done": false},
        {"id": "revs-d", "text": "Stock value to be made on basis of Stock on month end multiplied by purchase price for fuels as wells as lubes.", "done": false},
        {"id": "revs-e", "text": "Purchase Value to be calculated by multiplying the fuel and lubes wise purchase into purchase price.", "done": false}
      ]'::jsonb,
      ARRAY['monthly', 'excel', 'revenue', 'statement']
    );

  END IF;
END $$;
