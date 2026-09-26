# Print queue setup

Medication, Recommendation, Referral, and Admitting Orders are queued independently when a doctor saves notes. Empty sections are omitted. Doctors see their own documents; secretaries see accessible doctors' documents. The queue refreshes every 30 seconds and on opening the page.

Run `migrations/20260927_print_queue_sections.sql` in the Supabase SQL editor to enable independent printed status. This migration works with or without the previous whole-note print migration. New installations using the numbered scripts should also run `database/07-print-queue-sections.sql` (the same SQL).

Each entry previews and prints only its selected section with patient details. Select Mark printed after verifying the paper copy. Cancelling a print dialog leaves the item pending. Printing one section does not mark the other three printed. Changing a printed section queues that section again; editing unrelated note fields does not reset it. All saved notes allows reprinting.

Earlier whole-note receipts are preserved but do not mark individual documents printed. Until the new migration is installed, documents remain printable, but printed-status tracking is unavailable. Web/mobile builds do not deploy database migrations.
