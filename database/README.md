# Supabase SQL guide

Open the **same Supabase project used by `Javascript/supabase-config.js`**.
For every `.sql` file below, copy its entire contents into **SQL Editor → New query → Run**.
Policy scripts are SQL too: run them in SQL Editor, not the Edge Function editor.

## Existing project: patient registration error

**Current website:** run [repairs/02-role-based-patient-registration.sql](repairs/02-role-based-patient-registration.sql). The updated registration form calls `register_patient`, which checks the signed-in user's active staff role on the server. Admin, doctor and secretary can create patients. Missing or inactive profiles receive a specific error. Upload the updated `Javascript/patient-registration.js`, `Doctor/register.html`, and `Secretary/register.html` after running it. This function performs only patient creation with allowlisted fields; it does not disable RLS or change update/delete access. As a security-definer function, its explicit role check authorizes the insert independently of table RLS policies; existing constraints and triggers still apply.

Run [policies/01-doctor-patient-registration.sql](policies/01-doctor-patient-registration.sql).
This permits active doctors to insert patients and upload registration pictures.
It retains the existing admin/secretary policies and does not grant patient edit/delete access.
Then sign out of the website, sign back in, and retry.

If the save still reports a patients RLS error, run [policies/03-repair-patient-insert.sql](policies/03-repair-patient-insert.sql). This checks the signed-in UID against active staff directly, independently of `clinic_role()`. It adds an INSERT policy and preserves any custom policies; restrictive policies can still deny access.

For further diagnosis, run [diagnostics/01-patient-registration.sql](diagnostics/01-patient-registration.sql).
Check that the login's Authentication UID matches an active `staff` row with the intended role.
The SQL Editor session is not the website user's session.

## Patient profile pictures

Run [repairs/03-patient-profile-pictures.sql](repairs/03-patient-profile-pictures.sql) to enable upload, capture and saving pictures for active admin, doctor and secretary accounts. Upload the updated `Javascript/patient-profile.js`, `Doctor/profile.html` and `Secretary/profile.html`. Saves change only `record_pictures` and its update timestamp, enforce the four-picture limit, and reject stale edits. The `PatientRecordUploads` bucket and `valid_patient_pictures` function must already exist from the base setup. Camera capture needs browser/device permission and a supported secure context; uploading remains available.

## Existing project: staff account creation steps

1. Run [repairs/01-staff-profile-setup.sql](repairs/01-staff-profile-setup.sql) to restore the Auth profile trigger. It preserves existing staff and registration codes.
2. [policies/02-staff-service-permissions.sql](policies/02-staff-service-permissions.sql) contains the service-role grants separately. These are already included in the repair and can also be rerun independently.
3. Deploy the updated [DEPLOY-MANAGE-STAFF.ts](../supabase/DEPLOY-MANAGE-STAFF.ts) into **Edge Functions → manage-staff → Code → index.ts → Deploy updates**. This is TypeScript, not SQL.
4. Use [diagnostics/02-staff-setup.sql](diagnostics/02-staff-setup.sql) if account creation still fails.

The function's actual URL must end in `/functions/v1/manage-staff` for the current app configuration.
The supplied function checks the caller's login and role itself; its gateway legacy JWT verification setting is off.

## Brand-new empty project only

1. Run [setup/01-new-project.sql](setup/01-new-project.sql).
2. Run [repairs/01-staff-profile-setup.sql](repairs/01-staff-profile-setup.sql).
3. Run [policies/01-doctor-patient-registration.sql](policies/01-doctor-patient-registration.sql).
4. Run [repairs/02-role-based-patient-registration.sql](repairs/02-role-based-patient-registration.sql) for the current patient registration form.
5. Deploy the Edge Function described above and configure the app's new project URL/public key.

The setup bundle includes the base tables, relationships, functions, triggers, original RLS policies, realtime membership, and patient picture bucket configuration. The policies folder contains the subsequent fixes, not a complete standalone replacement for those base policies.

The setup bundle refuses to run when public tables already exist. Do not use it to repair an existing project. It copies no patient data or login accounts. Establish the initial administrator by creating an Auth user and linking its actual UID to a staff profile; account management requires an active administrator or doctor login.

## Optional staff signup codes

[optional/01-staff-registration-codes.sql](optional/01-staff-registration-codes.sql) enables the registration-code trigger and issues one code per role. Codes expire after seven days and work once. Every run issues additional codes.

The Register form has been removed from `index.html`, so this is **not part of the normal current setup**. Removing the form does not itself disable Supabase signup or invalidate previously issued codes.

## File organization

| Folder | Purpose |
| --- | --- |
| `setup/` | Complete empty-project schema installation |
| `repairs/` | Repair functions and triggers in an existing database |
| `policies/` | RLS changes and explicitly labeled database grants |
| `diagnostics/` | Read-only queries for troubleshooting |
| `optional/` | Optional staff signup code setup |

The numbered SQL files and older uppercase filenames directly under `database/`, plus `migrations/`, are retained for compatibility with existing tests and earlier links. The organized setup/repair/optional files are saved copies; future changes to their originals must also be reflected here. Follow this guide instead of running every SQL file in the repository.
