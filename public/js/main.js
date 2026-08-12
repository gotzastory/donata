import { PaymentForm } from './modules/PaymentForm.js';
import { PaymentService } from './services/PaymentService.js';

class App {
    constructor() {
        this.paymentService = new PaymentService();

        this.paymentForm = new PaymentForm(
            document.getElementById('payment-form'),
            this.handlePaymentSubmit.bind(this)
        );

        this.restoreFormData();
    }

    async handlePaymentSubmit(formData) {
        try {
            const response = await this.paymentService.createPayment(formData);

            this.saveFormData(formData);

            window.location.href = response.url;
        } catch (error) {
            this.showError(error.message);
        }
    }

    saveFormData(data) {
        sessionStorage.setItem('paymentData', JSON.stringify(data));
    }

    restoreFormData() {
        const savedData = sessionStorage.getItem('paymentData');
        if (savedData) {
            try {
                const data = JSON.parse(savedData);
                this.paymentForm.restore(data);
            } catch (error) {
                console.error('Error restoring form data:', error);
            } finally {
                sessionStorage.removeItem('paymentData');
            }
        }
    }

    showError(message) {
        const errorElement = document.getElementById('error-message');
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.style.display = 'block';
            setTimeout(() => {
                errorElement.style.display = 'none';
            }, 5000);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new App();
});
