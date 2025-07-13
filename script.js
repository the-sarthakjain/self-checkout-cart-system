import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getFirestore, collection, onSnapshot, doc, getDoc, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

// --- Firebase Configuration ---
const firebaseConfig = {
  apiKey: "AIzaSyAI49oaHHpHtJts31sraoZBq08u9yAtkG0",
  authDomain: "self-checkout-cart-system.firebaseapp.com",
  projectId: "self-checkout-cart-system",
  storageBucket: "self-checkout-cart-system.firebasestorage.app",
  messagingSenderId: "231081186084",
  appId: "1:231081186084:web:41a2b668399ae2d062d9b1",
  measurementId: "G-LW064FNZV4"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --- +++ NEW: UPI Configuration +++ ---
const UPI_ID = 'sarthakjainhwd04-1@oksbi';
const PAYEE_NAME = 'BillBee Store'; // This name will appear in the customer's UPI app

// --- DOM Element References ---
const dashboardScreen = document.getElementById('dashboard-screen');
const billDisplayScreen = document.getElementById('bill-display-screen');
const backButton = document.getElementById('back-to-dashboard-btn');
const paymentCompleteBtn = document.getElementById('payment-complete-btn');
const activeCartsCountEl = document.getElementById('active-carts-count');
const cartGridContainer = document.getElementById('cart-grid-container');
const billItemsTbody = document.getElementById('bill-items');
const grandTotalSpan = document.getElementById('grand-total-amount');
const billHeaderTitle = document.getElementById('bill-header-title');
const qrcodeContainer = document.getElementById('payment-section'); // Using ID for better selection
const successOverlay = document.getElementById('success-overlay');
const confirmationModal = document.getElementById('confirmation-modal');
const modalText = document.getElementById('modal-text');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
const modalConfirmBtn = document.getElementById('modal-confirm-btn');

// --- Global State ---
let masterCartList = [];
let activeBillListener = null;
let cartStatusListeners = {};
let currentCartId = null;

// --- Screen & Modal Logic (Unchanged) ---
function showBillScreen(cartId) {
    currentCartId = cartId;
    billHeaderTitle.textContent = formatCartName(cartId);
    listenForBillUpdates(cartId);
    dashboardScreen.classList.remove('active');
    billDisplayScreen.classList.add('active');
}

function showDashboardScreen() {
    if (activeBillListener) {
        activeBillListener();
        activeBillListener = null;
    }
    currentCartId = null;
    billDisplayScreen.classList.remove('active');
    dashboardScreen.classList.add('active');
}

function showConfirmationModal(text, onConfirm) {
    modalText.textContent = text;
    confirmationModal.classList.add('visible');
    const newConfirmBtn = modalConfirmBtn.cloneNode(true);
    modalConfirmBtn.parentNode.replaceChild(newConfirmBtn, modalConfirmBtn);
    newConfirmBtn.addEventListener('click', () => {
        confirmationModal.classList.remove('visible');
        onConfirm();
    }, { once: true });
}

// --- Event Listeners (Unchanged) ---
backButton.addEventListener('click', showDashboardScreen);
paymentCompleteBtn.addEventListener('click', () => {
    const text = `Finalize transaction for ${formatCartName(currentCartId)}? This will clear the cart and print the bill.`;
    showConfirmationModal(text, handlePaymentComplete);
});
modalCancelBtn.addEventListener('click', () => {
    confirmationModal.classList.remove('visible');
});

// --- Main Application Logic (Unchanged) ---
async function initializeDashboard() {
    try {
        const allCartsRef = collection(db, "all_carts");
        const snapshot = await getDocs(allCartsRef);
        masterCartList = snapshot.docs.map(doc => doc.id).sort();
        if (masterCartList.length === 0) {
            cartGridContainer.innerHTML = `<div class="empty-state"><p>No carts registered in 'all_carts' collection.</p></div>`;
            return;
        }
        renderCartButtons(masterCartList.map(id => ({ id, isActive: false })));
        monitorAllCarts();
    } catch (error) {
        console.error("Could not fetch the master cart list:", error);
        cartGridContainer.innerHTML = `<div class="empty-state"><p>Error: Could not load cart registry.</p></div>`;
    }
}

function monitorAllCarts() {
    const activeCartIds = new Set();
    masterCartList.forEach(cartId => {
        const cartCollectionRef = collection(db, cartId);
        const unsubscribe = onSnapshot(cartCollectionRef, (snapshot) => {
            if (snapshot.empty) {
                activeCartIds.delete(cartId);
            } else {
                activeCartIds.add(cartId);
            }
            updateDashboardUI(activeCartIds);
        });
        cartStatusListeners[cartId] = unsubscribe;
    });
}

function updateDashboardUI(activeCartIds) {
    activeCartsCountEl.textContent = activeCartIds.size;
    const cartStatusList = masterCartList.map(cartId => ({
        id: cartId,
        isActive: activeCartIds.has(cartId)
    }));
    cartStatusList.sort((a, b) => {
        if (a.isActive !== b.isActive) {
            return a.isActive ? -1 : 1;
        }
        return a.id.localeCompare(b.id);
    });
    renderCartButtons(cartStatusList);
}

function renderCartButtons(sortedCarts) {
    cartGridContainer.innerHTML = '';
    if (sortedCarts.length === 0) {
        cartGridContainer.innerHTML = `<div class="empty-state"><p>No carts to display.</p></div>`;
        return;
    }
    sortedCarts.forEach(cart => {
        const button = document.createElement('div');
        button.className = `cart-button ${cart.isActive ? 'active' : 'inactive'}`;
        button.textContent = formatCartName(cart.id);
        button.dataset.cartId = cart.id;
        if (cart.isActive) {
            button.addEventListener('click', () => showBillScreen(cart.id));
        }
        cartGridContainer.appendChild(button);
    });
}

function formatCartName(cartId) {
    if (!cartId) return '';
    
    // NEW, SMARTER REGEX:
    // Captures the initial lowercase word, then captures the rest if it starts with an uppercase letter or an underscore.
    const nameParts = cartId.match(/^([a-z]+)([A-Z_].*)$/);

    // If the regex doesn't match (e.g., for a simple ID like "stock"), return a capitalized version.
    if (!nameParts || nameParts.length < 3) {
        return cartId.charAt(0).toUpperCase() + cartId.slice(1);
    }

    // nameParts[1] will be 'cart'
    let wordPart = nameParts[1];
    
    // nameParts[2] will be 'A' or '_01'
    let idPart = nameParts[2];

    // Capitalize the first letter of the word part.
    const formattedWord = wordPart.charAt(0).toUpperCase() + wordPart.slice(1);

    // Clean up the ID part by removing any leading underscores and trimming space.
    const formattedId = idPart.replace(/^_/, '').trim(); 

    // Combine them with a space.
    return `${formattedWord} ${formattedId}`;
}

// --- Bill-specific Functions ---
function listenForBillUpdates(cartId) {
    if (activeBillListener) activeBillListener();
    const billCollectionRef = collection(db, cartId);
    activeBillListener = onSnapshot(billCollectionRef, async (snapshot) => {
        if (snapshot.empty) {
            renderBill([]);
            return;
        }
        const itemDetailPromises = snapshot.docs.map(itemDoc => {
            const barcode = itemDoc.id;
            const itemData = itemDoc.data();
            const stockDocRef = doc(db, "stock", barcode);
            return getDoc(stockDocRef).then(stockDoc => {
                if (stockDoc.exists()) {
                    return { ...stockDoc.data(), quantity: itemData.quantity || 0, id: barcode };
                }
                return { name: `Unknown Item (${barcode})`, price: 0, quantity: itemData.quantity || 0, id: barcode };
            });
        });
        const resolvedItems = await Promise.all(itemDetailPromises);
        renderBill(resolvedItems.filter(item => item !== null));
    });
}

// --- +++ UPDATED FUNCTION: renderBill now calls the QR code generator +++ ---
function renderBill(items) {
    billItemsTbody.innerHTML = '';
    let grandTotal = 0;

    if (items.length === 0) {
        billItemsTbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">This cart is empty.</td></tr>';
    } else {
        items.forEach(item => {
            const itemTotal = item.price * item.quantity;
            grandTotal += itemTotal;
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${item.name}</td>
                <td>₹${item.price.toFixed(2)}</td>
                <td>${item.quantity}</td>
                <td>₹${itemTotal.toFixed(2)}</td>
            `;
            billItemsTbody.appendChild(row);
        });
    }

    grandTotalSpan.textContent = `₹${grandTotal.toFixed(2)}`;
    
    // Call the QR code generator with the final amount
    generateUpiQrCode(grandTotal);
}

// --- +++ NEW FUNCTION: To generate the UPI QR Code +++ ---
function generateUpiQrCode(amount) {
    // Clear any previous QR code
    qrcodeContainer.innerHTML = ''; 

    // Don't generate a QR code if the amount is zero or less
    if (amount <= 0) {
        qrcodeContainer.innerHTML = `<p class="qr-placeholder-text">Add items to generate QR code.</p>`;
        return;
    }
    
    // The UPI QR string format
    const upiUrl = `upi://pay?pa=${UPI_ID}&pn=${encodeURIComponent(PAYEE_NAME)}&am=${amount.toFixed(2)}&cu=INR`;
    
    // Add a title and a canvas element for the QR code
    qrcodeContainer.innerHTML = `
        <h3>Scan to Pay</h3>
        <canvas id="qrcode-canvas"></canvas>
    `;
    
    const canvas = document.getElementById('qrcode-canvas');
    
    // Use the QRCode library to generate the code
    QRCode.toCanvas(canvas, upiUrl, { width: 200, margin: 2 }, function (error) {
        if (error) {
            console.error("QR Code generation failed:", error);
            qrcodeContainer.innerHTML = `<p class="qr-placeholder-text">Could not generate QR code.</p>`;
        }
        console.log('UPI QR code generated successfully!');
    });
}


// --- Payment and Deletion Logic (Unchanged) ---
async function handlePaymentComplete() {
    if (!currentCartId) return;
    handlePrintBill();
    try {
        await clearCartCollection(currentCartId);
        console.log(`All items in collection ${currentCartId} have been deleted.`);
        successOverlay.classList.add('visible');
        setTimeout(() => {
            successOverlay.classList.remove('visible');
            showDashboardScreen();
        }, 2000);
    } catch (error) {
        console.error("Error clearing cart collection:", error);
        alert("An error occurred while clearing the cart. Please check the console.");
    }
}

async function clearCartCollection(cartId) {
    const cartCollectionRef = collection(db, cartId);
    const snapshot = await getDocs(cartCollectionRef);
    if (snapshot.empty) return;
    const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
    await Promise.all(deletePromises);
}

// --- Printing Logic (Unchanged) ---
function handlePrintBill() {
    const printableBillHTML = generatePrintableBill();
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    iframe.contentDocument.write(printableBillHTML);
    iframe.contentDocument.close();
    iframe.contentWindow.print();
    setTimeout(() => document.body.removeChild(iframe), 1000);
}

function generatePrintableBill() {
    const billItemsHTML = billItemsTbody.innerHTML;
    const grandTotal = grandTotalSpan.innerHTML;
    const cartTitle = billHeaderTitle.innerHTML;
    const logoUrl = "./images/BillBee1-removebg-preview.png";
    return `
        <html><head><title>BillBee Receipt</title><style>
        body { font-family: 'Courier New', Courier, monospace; width: 300px; margin: 0 auto; color: #000; }
        .header { text-align: center; } .header img { max-width: 150px; margin-bottom: 10px; }
        h2, p { text-align: center; margin: 5px 0; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 14px; }
        th, td { padding: 5px; text-align: left; }
        thead tr { border-bottom: 1px dashed #000; }
        tbody td:nth-child(2), tbody td:nth-child(3) { text-align: center; }
        tbody td:last-child { text-align: right; }
        hr { border: none; border-top: 1px dashed #000; }
        .total-line { display: flex; justify-content: space-between; font-weight: bold; font-size: 1.1em; padding: 5px 0; }
        .footer-text { text-align: center; margin-top: 10px; font-size: 12px; }
        </style></head><body>
        <div class="header"><img src="${logoUrl}" alt="BillBee Logo"></div>
        <h2>Receipt</h2><p>${cartTitle}</p><p>${new Date().toLocaleString()}</p><hr>
        <table>
            <thead><tr><th>Item</th><th>Price</th><th>Qty</th><th style="text-align:right;">Total</th></tr></thead>
            <tbody>${billItemsHTML}</tbody>
        </table>
        <hr>
        <div class="total-line"><span>Grand Total:</span><span>${grandTotal}</span></div>
        <hr>
        <p class="footer-text">Thank you for shopping with us!</p>
        </body></html>
    `;
}

// --- Initializer ---
initializeDashboard();