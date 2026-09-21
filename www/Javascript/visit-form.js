class VisitFormController {
    constructor() {
        this.patientId = new URLSearchParams(window.location.search).get('patient_id');
        this.form = document.getElementById('visit-form');
        this.patientPanel = document.getElementById('visit-patient');
        this.doctorSelect = document.getElementById('doctor');
        this.status = document.getElementById('visit-status');
        this.client = window.entSupabase;
    }

    init() {
        this.form.addEventListener('submit', (event) => this.handleSubmit(event));
        if (!this.patientId) {
            this.setStatus('Select a patient before creating a visit.');
            return;
        }
        this.loadPatient();
        this.loadDoctors();
    }

    async loadPatient() {
        const { data: patient, error } = await this.client
            .from('patients')
            .select('id, first_name, middle_name, last_name, suffix, phone')
            .eq('id', this.patientId)
            .maybeSingle();

        if (error || !patient) {
            this.setStatus(error?.message || 'Patient record not found.');
            return;
        }

        const fullName = [patient.first_name, patient.middle_name, patient.last_name, patient.suffix].filter(Boolean).join(' ');
        this.patientPanel.innerHTML = `<div class="avatar">${this.escapeHtml(patient.first_name.charAt(0).toUpperCase())}</div>
            <div><strong>${this.escapeHtml(fullName)}</strong><small>${this.escapeHtml(patient.phone || 'Patient selected')}</small></div>
            <a class="outline" style="margin-left:auto" href="search.html">Change Patient</a>`;
    }

    async loadDoctors() {
        const { data: doctors, error } = await this.client
            .from('staff')
            .select('id, full_name')
            .eq('role', 'doctor')
            .order('full_name');

        if (error) {
            this.setStatus(error.message);
            return;
        }

        this.doctorSelect.innerHTML = '<option value="">Select doctor</option>';
        doctors.forEach((doctor) => {
            this.doctorSelect.add(new Option(doctor.full_name, doctor.id));
        });
    }

    async handleSubmit(event) {
        event.preventDefault();
        if (!this.client || !this.patientId) {
            this.setStatus('A connected patient and Supabase account are required.');
            return;
        }

        const formData = new FormData(this.form);
        const visit = {
            patient_id: this.patientId,
            clinic_location: formData.get('clinic_location') || null,
            doctor_id: formData.get('doctor_id') || null,
            reason: formData.get('reason') || null,
            blood_pressure: formData.get('blood_pressure') || null,
            temperature: formData.get('temperature') ? Number(formData.get('temperature')) : null,
            weight_kg: formData.get('weight_kg') ? Number(formData.get('weight_kg')) : null,
            notes: formData.get('notes') || null,
            status: 'waiting'
        };

        this.setStatus('Checking in patient...');
        const { error } = await this.client.from('visits').insert(visit);
        if (error) {
            this.setStatus(error.message);
            return;
        }

        window.location.href = 'queue.html';
    }

    setStatus(message) {
        this.status.textContent = message;
    }

    escapeHtml(value) {
        return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!await window.entSessionReady) return;
    const controller = new VisitFormController();
    controller.init();
});