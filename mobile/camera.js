import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

if (Capacitor.isNativePlatform()) {
    window.entCamera = {
        async capture() {
            const photo = await Camera.getPhoto({
                quality: 90,
                allowEditing: false,
                resultType: CameraResultType.Base64,
                source: CameraSource.Camera,
                direction: 'rear'
            });
            return `data:image/${photo.format};base64,${photo.base64String}`;
        }
    };
}