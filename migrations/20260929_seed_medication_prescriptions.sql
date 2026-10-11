-- Run after 20260929_medication_prescriptions_recommendations.sql.
-- Seed all active doctor/admin accounts that have not initialized a catalog.
-- Existing catalogs are left intact, including edited or intentionally empty lists.
-- New accounts still initialize their presets when they first open the application.
begin;
with new_catalogs as (
    insert into public.medication_prescription_catalogs (doctor_id)
    select id from public.staff where is_active = true and role in ('doctor', 'admin')
    on conflict (doctor_id) do nothing
    returning doctor_id
), medicines(position, name, remarks) as (
    values
        (1, 'PND', 'otic drops
Sig: 3 drops 3x/day x 7 days'),
        (2, 'Ofloxacin', 'otic drops
Sig: 3 drops 3x/day x 7 days'),
        (3, 'ESSPRIN', 'Throat Spray
Sig: 2 sprays 3x /day x 7 days'),
        (4, 'NASAFLO', 'nasal spray
50mcg/Actuation 
Sig: 2 spray 2x a day x 1 month'),
        (5, 'ZYKAST', 'Levocetirizine + Montelukast
Sig: 1 tab once a day x 2 weeks'),
        (6, 'Czymocort', 'nasal spray
500mcg/ml 
Sig: 2 spray 2x/day 1 month each nasal cavity'),
        (7, 'ALLERKAST', 'Levocetirizine + Montelukast
Sig: 1 tab once a day x 2 weeks'),
        (8, 'Coamoxiclav', '625mg/tab
Sig: 1 tab 2x/day x 7 days'),
        (9, 'Cefuroxime', '500mg/tab
Sig: 1 tab 2x/day x 7 days'),
        (10, 'Pantoprazole', '40mg/tab
Sig: 1 tab once a day x 2 weeks'),
        (11, 'Methylprednisolone', '16mg/tab
Sig: 1 tab 2x/day x 5 days'),
        (12, 'Celecoxib', '200mg/tab
Sig: 1 tab 2x/day'),
        (13, 'Betahistine', '24mg/tab
Sig: 1 tab 2x/day x 7 days')
)
insert into public.medication_prescriptions (doctor_id, position, name, remarks)
select c.doctor_id, m.position, m.name, m.remarks
from new_catalogs c cross join medicines m;
commit;

-- Check stored medications after running the seed.
select doctor_id, position, name, remarks
from public.medication_prescriptions
order by doctor_id, position;
