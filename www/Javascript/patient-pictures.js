// Pictures are resized and stored with the patient, under the same access policies.
class PatientPictures {
    constructor(root, pictures = [], editable = true) {
        this.root = root;
        this.pictures = [...pictures];
        this.editable = editable;
        this.busy = false;
        this.render();
    }

    render() {
        this.root.replaceChildren();
        const heading = document.createElement('h3');
        heading.textContent = 'Picture Patient Record';
        this.root.append(heading);
        const help = document.createElement('p');
        help.textContent = `${this.pictures.length} of 4 pictures. ${this.editable ? 'Optional: upload or capture 1 to 4 pictures. JPEG, PNG or WebP, up to 10 MB each.' : ''}`;
        this.root.append(help);
        const grid = document.createElement('div');
        grid.className = 'patient-picture-grid';
        this.pictures.forEach((source, index) => {
            const card = document.createElement('div');
            const img = document.createElement('img');
            img.src = source;
            img.alt = `Patient record picture ${index + 1}`;
            card.append(img);
            if (this.editable) {
                card.append(this.button('Remove', () => { this.pictures.splice(index, 1); this.render(); }));
                card.append(this.button('Retake capture', () => this.pick(true, index)));
            }
            grid.append(card);
        });
        this.root.append(grid);
        if (this.editable && this.pictures.length < 4) {
            this.root.append(this.button('Upload pictures', () => this.pick(false)));
            this.root.append(this.button('Capture picture', () => this.pick(true)));
        }
        this.status = document.createElement('p');
        this.status.setAttribute('role', 'status');
        this.root.append(this.status);
    }

    button(label, action) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'outline';
        button.textContent = label;
        button.disabled = this.busy;
        button.addEventListener('click', action);
        return button;
    }

    pick(capture, index = null) {
        if (capture && index === null) {
            if (window.entCamera) {
                this.captureWithCamera(window.entCamera.capture);
                return;
            }
            if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
                this.captureWithCamera(() => this.captureFromBrowser());
                return;
            }
        }
        const input = document.createElement('input');
        input.type = 'file';
        // Capacitor's Android camera handler checks for the literal image/* type.
        input.accept = capture ? 'image/*' : 'image/jpeg,image/png,image/webp';
        input.multiple = !capture && index === null;
        if (capture) input.setAttribute('capture', 'environment');
        input.addEventListener('change', () => this.addFiles([...input.files], index));
        input.click();
    }

    async captureWithCamera(capture) {
        if (this.busy) return;
        this.busy = true;
        this.render();
        this.status.textContent = 'Opening camera…';
        try {
            const dataUrl = await capture();
            const response = await fetch(dataUrl);
            const file = new File([await response.blob()], `patient-picture-${Date.now()}.jpg`, {type: 'image/jpeg'});
            this.busy = false;
            await this.addFiles([file]);
        } catch (error) {
            this.busy = false;
            this.render();
            if (error?.message?.toLowerCase().includes('cancel')) return;
            this.status.textContent = 'Unable to open the camera. Please try again.';
        }
    }

    async captureFromBrowser() {
        const stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: {ideal: 'environment'}}});
        const dialog = document.createElement('dialog');
        const video = document.createElement('video');
        video.autoplay = true;
        video.playsInline = true;
        video.srcObject = stream;
        const capture = document.createElement('button');
        capture.type = 'button';
        capture.textContent = 'Take picture';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Cancel';
        dialog.append(video, capture, cancel);
        document.body.append(dialog);
        dialog.showModal();
        const close = () => {
            stream.getTracks().forEach(track => track.stop());
            dialog.remove();
        };
        const dataUrl = await new Promise((resolve, reject) => {
            cancel.addEventListener('click', () => { close(); reject(new Error('cancelled')); }, {once: true});
            capture.addEventListener('click', () => {
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                canvas.getContext('2d').drawImage(video, 0, 0);
                resolve(canvas.toDataURL('image/jpeg', 0.9));
                close();
            }, {once: true});
            dialog.addEventListener('cancel', () => { close(); reject(new Error('cancelled')); }, {once: true});
        });
        return dataUrl;
    }

    async addFiles(files, index = null) {
        if (!files.length || this.busy) return;
        if (files.length > (index === null ? 4 - this.pictures.length : 1)) {
            this.status.textContent = 'Select no more than four pictures in total.';
            return;
        }
        this.busy = true;
        this.render();
        this.status.textContent = 'Preparing pictures…';
        try {
            const pictures = [];
            for (const file of files) pictures.push(await PatientPictures.encode(file));
            if (index === null) this.pictures.push(...pictures);
            else this.pictures[index] = pictures[0];
            this.busy = false;
            this.render();
        } catch (error) {
            this.busy = false;
            this.render();
            this.status.textContent = error.message;
        }
    }

    static async encode(file) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
            throw new Error('Choose a JPEG, PNG or WebP picture smaller than 10 MB.');
        }
        const url = URL.createObjectURL(file);
        try {
            const img = new Image();
            img.src = url;
            await img.decode();
            const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const data = canvas.toDataURL('image/jpeg', 0.8);
            if (data.length > 1500000) throw new Error('This picture is too detailed. Choose a smaller picture.');
            return data;
        } catch (error) {
            throw new Error(error.message.includes('too detailed') ? error.message : 'Unable to read this picture. Choose another file.');
        } finally { URL.revokeObjectURL(url); }
    }
}
window.PatientPictures = PatientPictures;
