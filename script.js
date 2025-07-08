// ===================================================================
// STEP 1: PASTE YOUR FIREBASE CONFIGURATION HERE
// ===================================================================
const firebaseConfig = {
  apiKey: "AIzaSyAI49oaHHpHtJts31sraoZBq08u9yAtkG0",
  authDomain: "self-checkout-cart-system.firebaseapp.com",
  projectId: "self-checkout-cart-system",
  storageBucket: "self-checkout-cart-system.firebasestorage.app",
  messagingSenderId: "231081186084",
  appId: "1:231081186084:web:2aabdcd9570952a062d9b1"
};

// ===================================================================
// DO NOT EDIT BELOW THIS LINE
// ===================================================================

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Get references to our HTML elements
const resultElement = document.getElementById('scan-result');
const readerElement = document.getElementById('reader');

let isProcessing = false; // A flag to prevent scanning multiple barcodes at once

/**
 * Resets the status message and styling after a delay.
 */
function resetStatus() {
    resultElement.textContent = "Point camera at a barcode";
    resultElement.className = '';
}

/**
 * This function is the main brain. It's called whenever a barcode is successfully scanned.
 * @param {string} barcode - The barcode number that was scanned.
 */
async function processBarcode(barcode) {
    // If we are already busy processing a barcode, ignore this new one.
    if (isProcessing) {
        return;
    }
    isProcessing = true; // Set the flag to true

    console.log(`Scanned barcode: ${barcode}`);
    resultElement.textContent = "Processing...";

    try {
        const productRef = db.collection('products').doc(barcode);
        const productDoc = await productRef.get();

        if (productDoc.exists) {
            const productData = productDoc.data();
            
            // --- FEATURE: Check for Expiry ---
            if (barcode.endsWith('9')) {
                console.warn("Expired item detected:", productData.name);
                resultElement.textContent = `EXPIRED: ${productData.name}`;
                resultElement.classList.add('error');
            } else {
                // Product is valid, add it to the cart
                const cartRef = db.collection('carts').doc('cart_01');
                await cartRef.update({
                    items: firebase.firestore.FieldValue.arrayUnion({
                        barcode: barcode,
                        name: productData.name,
                        price: productData.price
                    })
                });

                console.log("Item added to cart!");
                resultElement.textContent = `Added: ${productData.name}`;
                resultElement.classList.add('success');
            }
        } else {
            console.error("Product not found in database");
            resultElement.textContent = "Error: Product Not Found";
            resultElement.classList.add('error');
        }
    } catch (error) {
        console.error("Error processing barcode:", error);
        resultElement.textContent = "An error occurred.";
        resultElement.classList.add('error');
    }

    // --- THIS IS THE IMPORTANT NEW PART ---
    // After 2 seconds, reset the message and allow a new scan.
    setTimeout(() => {
        resetStatus();
        isProcessing = false; // Reset the flag
    }, 2000); // 2000 milliseconds = 2 seconds
}

function onScanSuccess(decodedText, decodedResult) {
    processBarcode(decodedText);
}

// When the webpage is fully loaded, start the scanner
document.addEventListener('DOMContentLoaded', (event) => {
    var html5QrcodeScanner = new Html5QrcodeScanner(
        "reader",
        {
            fps: 10,
            qrbox: { width: 250, height: 150 }
        },
        false);

    html5QrcodeScanner.render(onScanSuccess);
});