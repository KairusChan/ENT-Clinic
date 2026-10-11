# Print queue setup

Medication, Recommendation, Referral, and Admitting Orders are queued independently when a doctor saves notes. Empty sections are omitted. Doctors see their own documents; secretaries see accessible doctors' documents. The queue refreshes every 30 seconds and on opening the page.

Run `migrations/20260927_print_queue_sections.sql` in the Supabase SQL editor to enable independent printed status. This migration works with or without the previous whole-note print migration. New installations using the numbered scripts should also run `database/07-print-queue-sections.sql` (the same SQL).

Each entry previews and prints only its selected section with patient details. Select Mark printed after verifying the paper copy. Cancelling a print dialog leaves the item pending. Printing one section does not mark the other three printed. Changing a printed section queues that section again; editing unrelated note fields does not reset it. All saved notes allows reprinting.

Earlier whole-note receipts are preserved but do not mark individual documents printed. Until the new migration is installed, documents remain printable, but printed-status tracking is unavailable. Web/mobile builds do not deploy database migrations.

## Phone and tablet printing

The Android app opens the device print dialog from consultation Print buttons and the doctor/secretary print queue. Select an available printer or Save as PDF. A printer must be available through the device's configured print service. Browser users continue to use the browser print dialog, including supported mobile and tablet browsers.

Build and install the updated APK using `scripts/build-debug-apk.ps1`; copying web assets alone does not install the native printing plugin. The output is `artifacts/ENT-Clinic-debug.apk`. This repository does not contain an iOS native app.

Device acceptance check: print a saved document from both Consultation and Print Queue, check its patient details and artwork in preview, save a PDF or print a paper copy, then cancel a second attempt and verify it stays pending until Mark printed is selected. Repeat on an Android phone and tablet.
