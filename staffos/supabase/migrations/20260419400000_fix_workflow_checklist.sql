-- Fix: Ensure workflow steps (checklist) are correctly set on all template tasks
-- This updates any template tasks that have empty checklists but should have workflow steps

-- Stock Sheet
UPDATE public.tasks
SET checklist = '[
  {"id": "ss-a", "text": "Entry of Daily Sale in litres.", "done": false},
  {"id": "ss-b", "text": "Entry of Daily Stock in litres.", "done": false},
  {"id": "ss-c", "text": "Entry of Daily Purchase in litres.", "done": false},
  {"id": "ss-d", "text": "Entry of Day Variation in litres.", "done": false}
]'::jsonb
WHERE is_template = true AND title = 'Stock Sheet' AND (checklist = '[]'::jsonb OR checklist IS NULL);

-- Tank Stock Sheet
UPDATE public.tasks
SET checklist = '[
  {"id": "tss-a", "text": "Entry of Tank Stock with Dip in millilitres and Litres.", "done": false}
]'::jsonb
WHERE is_template = true AND title = 'Tank Stock Sheet' AND (checklist = '[]'::jsonb OR checklist IS NULL);

-- Nozzle Reading Sheet
UPDATE public.tasks
SET checklist = '[
  {"id": "nrs-a", "text": "Entry of Nozzle Readings – Closing Balance of Everyday. Only Opening Balance on Year Start", "done": false}
]'::jsonb
WHERE is_template = true AND title = 'Nozzle Reading Sheet' AND (checklist = '[]'::jsonb OR checklist IS NULL);

-- Expenses Sheet (daily-excel)
UPDATE public.tasks
SET checklist = '[
  {"id": "es-a", "text": "Entry of Expenses with mode of payment of Expense. Flag Daily Expenses if Exceeding any limiters.", "done": false},
  {"id": "es-b", "text": "Cash Expense total to be separated for future purposes. Other modes to be segregated as well.", "done": false},
  {"id": "es-c", "text": "Any and all Expenses (apart from Grocery/Ration) bills required. Bill to be received online and to be told to store physical copy at fuel station and digital copy at office.", "done": false},
  {"id": "es-d", "text": "If no bill received, the bill is to be flagged for discrepancies and issue to be raised.", "done": false}
]'::jsonb
WHERE is_template = true AND title = 'Expenses Sheet' AND task_category = 'daily-excel' AND (checklist = '[]'::jsonb OR checklist IS NULL);

-- Purchase Sheet
UPDATE public.tasks
SET checklist = '[
  {"id": "ps-a", "text": "Entry of Purchase invoice with all details – Price / VAT / Surcharge / CESS / SSLF.", "done": false},
  {"id": "ps-b", "text": "Invoice of Purchase to be saved in office daily. Digital Copy in respective folder of respective firm in respective period.", "done": false}
]'::jsonb
WHERE is_template = true AND title = 'Purchase Sheet' AND (checklist = '[]'::jsonb OR checklist IS NULL);

-- Revenue for Day Sheet
UPDATE public.tasks
SET checklist = '[
  {"id": "rds-a", "text": "Add Details from cash flow statement regarding sale of fuel and mode of payments fuel wise.", "done": false},
  {"id": "rds-b", "text": "Put it heading-wise in MS/ HSD/CNG /Power/Speed based on amount from Cash Sale/Credit Sale/ Card Machine Sale/ PhonePe or PayTM Sale.", "done": false},
  {"id": "rds-c", "text": "Get Total Revenue for Day. This to be matched with day Revenue in Stock sheet. Flagged in case of discrepancy.", "done": false},
  {"id": "rds-d", "text": "Get total Cash Collected for Day.", "done": false}
]'::jsonb
WHERE is_template = true AND title = 'Revenue for Day Sheet' AND (checklist = '[]'::jsonb OR checklist IS NULL);

-- Bank – Cash Flow
UPDATE public.tasks
SET checklist = '[
  {"id": "bcf-a", "text": "Add Total Cash Collected for Day from Revenue for Day Sheet and add in Day Cash Sale Receipts column.", "done": false},
  {"id": "bcf-b", "text": "Entry of Bank Deposits made on Said date which is to be cross checked with bank statement and flagged if any discrepancies arise.", "done": false},
  {"id": "bcf-c", "text": "Entry of Cash Expenses based on total of all expenses paid through cash", "done": false},
  {"id": "bcf-d", "text": "Other inward and outward flow of cash to be justified with statement and Note. If no Note is provided to be questioned and flagged.", "done": false},
  {"id": "bcf-e", "text": "Balance of Net Cash in hand to be matched with Capital A/C sheet", "done": false}
]'::jsonb
WHERE is_template = true AND title = 'Bank – Cash Flow' AND (checklist = '[]'::jsonb OR checklist IS NULL);

-- Challan Sheet
UPDATE public.tasks
SET checklist = '[
  {"id": "cs-a", "text": "HSD / Petrol /CNG Challans to be added with name of Purchaser, Vehicle Number, Item Sold, Quantity, Price/ Rate and Amount.", "done": false},
  {"id": "cs-b", "text": "If Purchaser takes Lubes and oils, it is also to be added with appropriate details.", "done": false},
  {"id": "cs-c", "text": "On Cash Bills Details to be added for easy entry in Vyapaar. Add the letter \"C\" in Note of Said challan.", "done": false}
]'::jsonb
WHERE is_template = true AND title = 'Challan Sheet' AND (checklist = '[]'::jsonb OR checklist IS NULL);

-- Credit Sheet – Sundry Debtors
UPDATE public.tasks
SET checklist = '[
  {"id": "csd-a", "text": "Total Day Challan details to be added depending on customer – litres purchased, purchase amount (discount to be deducted; e.g. = 90 – 1 = Rs. 89) to be added daily to Credit Party Purchase Amount.", "done": false},
  {"id": "csd-b", "text": "Receipt Amount to be entered as well.", "done": false},
  {"id": "csd-c", "text": "Additional entries of other sales like cash or lubes and oils sale to be added.", "done": false},
  {"id": "csd-d", "text": "When balance for respective party is found, it is to be matched with data provided from site manager and to be notified for discrepancies to respective managers.", "done": false},
  {"id": "csd-e", "text": "Confirm total", "done": false}
]'::jsonb
WHERE is_template = true AND title = 'Credit Sheet – Sundry Debtors' AND (checklist = '[]'::jsonb OR checklist IS NULL);

-- Capital Sheet (daily-excel)
UPDATE public.tasks
SET checklist = '[
  {"id": "cap-a", "text": "Entry of HPCL / BPCL Portal balances in sheet with bifurcation for fuels MS/HSD, Lubes and Natural Gas.", "done": false},
  {"id": "cap-b", "text": "Entry of Sundry debtors or credit parties balance total in the capital sheet.", "done": false},
  {"id": "cap-c", "text": "Stock of each respective fuel to be multiplied by Stock purchase value to get Stock Value of each fuel and Stock of lubes to be maintained everyday.", "done": false},
  {"id": "cap-d", "text": "Add daily bank closing balance.", "done": false},
  {"id": "cap-e", "text": "Get Daily Net Capital from Formula and Notify in case it causes any discrepancy in limiters.", "done": false}
]'::jsonb
WHERE is_template = true AND title = 'Capital Sheet' AND task_category = 'daily-excel' AND (checklist = '[]'::jsonb OR checklist IS NULL);

-- Lubes and Oils Sheet
UPDATE public.tasks
SET checklist = '[
  {"id": "lo-a", "text": "Fill details – Name of customer, Product, Quantity, Price, GST and Payment Mode.", "done": false}
]'::jsonb
WHERE is_template = true AND title = 'Lubes and Oils Sheet' AND (checklist = '[]'::jsonb OR checklist IS NULL);

-- Receipts Sheet
UPDATE public.tasks
SET checklist = '[
  {"id": "rs-a", "text": "Receipts to be taken from data with Party Name, amount and Mode of Payment.", "done": false},
  {"id": "rs-b", "text": "This Receipt to be cross verified in respective mode of payment and flagged if any discrepancies arise.", "done": false}
]'::jsonb
WHERE is_template = true AND title = 'Receipts Sheet' AND (checklist = '[]'::jsonb OR checklist IS NULL);

-- Logistics Sheet
UPDATE public.tasks
SET checklist = '[
  {"id": "ls-a", "text": "To Fill daily expenses with Particulars and getting cumulative expenses.", "done": false},
  {"id": "ls-b", "text": "To Fill income in Different sources by getting from HPCL/BPCL Transport Portal divided into two sources which is observed on 15th every month: Income in Bank, Income in Card, Toll Payments Reimbursements", "done": false},
  {"id": "ls-c", "text": "The invoice to for these income receipts and expense payments to be saved.", "done": false},
  {"id": "ls-d", "text": "Expenses to be flagged based on limiters.", "done": false},
  {"id": "ls-e", "text": "No receipt of payment in bank A/C to be flagged as well. Card payment to be confirmed with card portal.", "done": false}
]'::jsonb
WHERE is_template = true AND title = 'Logistics Sheet' AND (checklist = '[]'::jsonb OR checklist IS NULL);

-- Filing of following post finalisation (monthly)
UPDATE public.tasks
SET checklist = '[
  {"id": "fil-a", "text": "GST 1 = 9th Monthly", "done": false},
  {"id": "fil-b", "text": "GST 3 = 19th Monthly", "done": false},
  {"id": "fil-c", "text": "TDS = 5th Monthly", "done": false},
  {"id": "fil-d", "text": "TDS Returns = Last date of Quarter", "done": false},
  {"id": "fil-e", "text": "PTEC – 15th June = Rs. 2500/-", "done": false},
  {"id": "fil-f", "text": "PTRC – 15th March of following year", "done": false},
  {"id": "fil-g", "text": "GST 9 – Dec 31 Annually for preceding financial year.", "done": false},
  {"id": "fil-h", "text": "AOC 4 – Annually", "done": false},
  {"id": "fil-i", "text": "MGT 7 – Annually", "done": false}
]'::jsonb
WHERE is_template = true AND title = 'Filing of following post finalisation.' AND (checklist = '[]'::jsonb OR checklist IS NULL);

-- Profit and Loss Sheet (monthly-excel)
UPDATE public.tasks
SET checklist = '[
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
]'::jsonb
WHERE is_template = true AND title = 'Profit and Loss Sheet.' AND (checklist = '[]'::jsonb OR checklist IS NULL);

-- Monthly Expenses Sheet
UPDATE public.tasks
SET checklist = '[
  {"id": "mes-a", "text": "Add Expenses from PNL book made by manager as. Match expenses and cross check and tally with daily expenses in terms of entry, amount and mode of payment. In case of discrepancy notify.", "done": false},
  {"id": "mes-b", "text": "Cumulative Expenses of PNL provided should match the total closing balances of month from daily log excel at end of month.", "done": false},
  {"id": "mes-c", "text": "All expenses to be checked with respective invoices and flagged in case of discrepancies in case of no invoice for purchase received (excluding ration)", "done": false}
]'::jsonb
WHERE is_template = true AND title = 'Expenses Sheet' AND task_category = 'monthly-excel' AND (checklist = '[]'::jsonb OR checklist IS NULL);

-- Monthly Capital Sheet
UPDATE public.tasks
SET checklist = '[
  {"id": "mcs-a", "text": "Entry of HPCL / BPCL Portal balances in sheet with bifurcation for fuels MS/HSD, Lubes and Natural Gas from last day of month.", "done": false},
  {"id": "mcs-b", "text": "Entry of Sundry debtors or credit parties balance total in the capital sheet from last day of month.", "done": false},
  {"id": "mcs-c", "text": "Stock of each respective fuel to be multiplied by Stock purchase value to get Stock Value of each fuel and Stock of lubes on month end.", "done": false},
  {"id": "mcs-d", "text": "Add month bank closing balance.", "done": false},
  {"id": "mcs-e", "text": "Get Net Capital from Formula.", "done": false}
]'::jsonb
WHERE is_template = true AND title = 'Capital Sheet' AND task_category = 'monthly-excel' AND (checklist = '[]'::jsonb OR checklist IS NULL);

-- Debtors Statement Sheet
UPDATE public.tasks
SET checklist = '[
  {"id": "dss-a", "text": "To be made at month end for credit parties or sundry debtors.", "done": false},
  {"id": "dss-b", "text": "Total month sale to each party in terms of fuel to be added; value to be removed on price with discount (if applicable).", "done": false},
  {"id": "dss-c", "text": "Cash taken to be entered.", "done": false},
  {"id": "dss-d", "text": "Lube Sale to be entered separately.", "done": false},
  {"id": "dss-e", "text": "Receipts for the month to be entered and balance to be removed as per: Opening Balance + (Month Sale ltr x Sale price) + Cash + Lube Sale – Receipts = Closing Balance", "done": false},
  {"id": "dss-f", "text": "Opening balance to be taken as per last year''s closing balance and for each months closing balance to be taken as next month''s opening balance.", "done": false}
]'::jsonb
WHERE is_template = true AND title = 'Debtors Statement Sheet' AND (checklist = '[]'::jsonb OR checklist IS NULL);

-- Revenue Statement
UPDATE public.tasks
SET checklist = '[
  {"id": "revs-a", "text": "Revenue Statement to be made on month end using total month sale.", "done": false},
  {"id": "revs-b", "text": "It is to be made by multiplying sale volume x sale price of each product.", "done": false},
  {"id": "revs-c", "text": "Products are to be divided into 3 categories: GST Sale, Non GST Sale, VAT Sale", "done": false},
  {"id": "revs-d", "text": "Stock value to be made on basis of Stock on month end multiplied by purchase price for fuels as wells as lubes.", "done": false},
  {"id": "revs-e", "text": "Purchase Value to be calculated by multiplying the fuel and lubes wise purchase into purchase price.", "done": false}
]'::jsonb
WHERE is_template = true AND title = 'Revenue Statement' AND (checklist = '[]'::jsonb OR checklist IS NULL);

-- Add index for assigned_user_ids array containment queries (performance)
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_user_ids ON public.tasks USING GIN (assigned_user_ids);
