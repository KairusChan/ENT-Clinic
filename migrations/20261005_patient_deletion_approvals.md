Apply `20261005_patient_deletion_approvals.sql` to the existing Supabase database before deploying these frontend changes. It requires the existing staff, patient, visit, and Notes tables and the `clinic_role()` helper. The same SQL is included in `supabase-schema.sql` for fresh installations.

The identity check rejects new patients with the same normalized first name, last name, and date of birth. Names ignore case and repeated spaces; middle names do not create a separate identity. Legacy duplicates are retained so cleanup tools can be installed. When duplicates prevent creation of the unique index, a database trigger protects new registrations while existing records remain accessible. Apply `20261006_consultation_transfers.sql` to transfer saved consultations with approval, then request deletion of the duplicate and create the unique index after cleanup. Do not rerun this migration if its tables already exist.

Secretaries use **Ask doctor to approve deletion** on a patient profile and supply a reason. Active doctors review pending requests on their dashboard or Patient Lists. Approval permanently deletes the patient and associated appointments; rejection retains the patient. Requests retain the patient label, requester, reason, decision, reviewer, and timestamps. Saved notes and active or completed consultations prevent deletion. Pending requests block visit changes and notes until reviewed.

Deployment verification with test records:

1. Register a patient, then try the same name/birthdate with different case, spaces, or middle name. The existing profile link should appear without a new record or picture upload.
2. As a secretary, request deletion of an unused test patient. Confirm there is only one pending request and that consultation acceptance is blocked.
3. As a doctor, reject the request and confirm the patient can resume normal scheduling.
4. Request again and approve. Confirm the patient disappears from Patient Lists and the approved audit row remains in `patient_deletion_requests`.
5. Verify that patients with saved notes or consultations in progress cannot be requested for deletion, and a secretary cannot call the review RPC or directly modify request rows.

Local JavaScript tests cover the UI and duplicate preflight using mocked database responses. Run the checks above against a test database to verify RLS, triggers, and transactional behavior before production deployment.
