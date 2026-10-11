Apply `20261006_consultation_transfers.sql` after the deletion approval migration and existing consultation migrations. Then apply `20261007_approval_status_overrides.sql` for the current behavior: waiting/active visits and pending deletion requests no longer block approved transfers. The details below describe this migration's original behavior; the override migration documentation describes the updated rules. The new migration preserves all patient records and does not transfer anything until doctors approve a secretary's request. For installations where the earlier deletion migration failed because of legacy duplicate identities, use the updated `20261005_patient_deletion_approvals.sql` first; it now retains those duplicates instead of blocking installation. If the deletion migration already succeeded, apply only the new migrations.

Secretary workflow:

1. Open the duplicate patient's profile and use **Transfer patient consultations**.
2. Search for and select the patient record to keep. Check the full name, middle name, birthdate, and patient ID, then enter the reason.
3. Submit one request for all saved consultations on that source record.
4. After approval and transfer, refresh the profile to verify its consultation history. The secretary can then request deletion of the duplicate using the separate deletion approval workflow.

Doctors review requests on Dashboard or Patient Lists. Source and destination profiles are linked. Every authoring doctor must approve; when the final doctor approves, the entire batch moves in one database transaction. A single rejection ends the request without moving anything. A doctor who has already approved can still reject a pending request if it becomes stale.

The transfer changes only the patient association on the selected visits and notes. It retains consultation and note IDs, dates, doctor attribution, clinical text, recommendation records, and print receipt references. Existing destination consultations remain intact. Historical print snapshots are retained; the changed patient association causes the current note snapshot to differ when determining whether another print is needed. The source patient is not deleted automatically. Demographics, pictures, and appointments without saved notes stay on the original record.

Pending requests protect both patients from deletion. Active consultations must finish before requesting or completing a transfer. Changes to either patient's identifying fields, the source's saved consultations, or their visit details require rejection and a new request. Each request stores identity labels, counts, reason, requester, author approvals, and final decision; private snapshots record the transferred visits and notes without exposing other doctors' note text through the request API. A transfer does not grant any client permission to directly reassign notes or visits.

After legacy duplicate cleanup, enforce the identity index if it was deferred:

```sql
create unique index if not exists patients_name_birthdate_unique
on public.patients (public.patient_name_key(first_name), public.patient_name_key(last_name), date_of_birth)
where date_of_birth is not null;
```

Validation: `node --test --experimental-test-isolation=none tests/*.test.cjs`. Database tests run the real migrations against an isolated PGlite PostgreSQL database with simulated Supabase authentication and RLS. They cover multi-doctor approval, rejection, preserved note/child IDs, subsequent duplicate deletion, stale requests, denied access, rollback after failure, and legacy duplicate handling. These tests do not connect to the live Supabase database or simulate concurrent database sessions. Apply and verify the migration in the deployment database before using the new UI.
