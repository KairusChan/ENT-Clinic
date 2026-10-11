import { Capacitor, registerPlugin } from '@capacitor/core';

if (Capacitor.getPlatform() === 'android') {
    const printer = registerPlugin('ClinicPrint');
    window.entPrint = () => printer.print();
}
