import cv2
import numpy as np
import os
import time
import firebase_admin
from firebase_admin import credentials, firestore
from threading import Event

# ==============================================================================
# --- CONFIGURATION: EDIT THESE VALUES ---
# ==============================================================================
SERVICE_ACCOUNT_KEY_PATH = "serviceAccountKey.json"
IMAGE_DATABASE_PATH = "S:/walmart/images"

# The name of the temporary cart collection being watched
THIS_CART_ID = "cart_01" 

# The name of the final bill / success collection
SUCCESS_COLLECTION_NAME = "cartA"

# Tuning parameters
MATCH_THRESHOLD = 20
LOWE_RATIO = 0.7
CAMERA_INDEX = 1

# ==============================================================================
# --- GLOBAL VARIABLES & INITIALIZATION ---
# ==============================================================================
try:
    cred = credentials.Certificate(SERVICE_ACCOUNT_KEY_PATH)
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("✅ Successfully connected to Firebase.")
except Exception as e:
    print(f"❌ FATAL ERROR: Could not initialize Firebase. Check '{SERVICE_ACCOUNT_KEY_PATH}'.")
    exit()

# ==============================================================================
# --- Helper Functions (Camera and Verification Logic - Unchanged) ---
# ==============================================================================
def capture_image_from_cart_camera():
    """Accesses the webcam, captures a single frame, saves it, and returns the path."""
    output_filename = "captured_item.jpg"
    print(f"📸  Accessing camera at index {CAMERA_INDEX}...")
    cap = cv2.VideoCapture(CAMERA_INDEX, cv2.CAP_DSHOW)
    if not cap.isOpened():
        print(f"❌  FATAL CAMERA ERROR: Cannot open camera at index {CAMERA_INDEX}.")
        return None
    ret, frame = cap.read()
    cap.release()
    if ret:
        cv2.imwrite(output_filename, frame)
        print(f"   -> Image successfully captured and saved as '{output_filename}'")
        return output_filename
    else:
        print("❌  CAMERA ERROR: Failed to capture frame from the camera.")
        return None

def verify_product(scanned_barcode, new_item_image_path):
    """Verifies an item against the given barcode."""
    print(f"\n--- Verifying against Barcode: {scanned_barcode} ---")
    orb = cv2.ORB_create(nfeatures=1000)
    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)
    img_new = cv2.imread(new_item_image_path, cv2.IMREAD_GRAYSCALE)
    if img_new is None: return (False, 0, "Image Error")
    kp_new, des_new = orb.detectAndCompute(img_new, None)
    if des_new is None: return (False, 0, "Image Error")
    print(f"Found {len(kp_new)} features in new item.")
    canonical_images_dir = os.path.join(IMAGE_DATABASE_PATH, scanned_barcode)
    if not os.path.isdir(canonical_images_dir): return (False, 0, "Local DB Error")
    best_match_score = 0
    # ... (rest of vision logic is unchanged) ...
    canonical_image_files = [f for f in os.listdir(canonical_images_dir) if f.lower().endswith(('.png', '.jpg', '.jpeg'))]
    for filename in canonical_image_files:
        canonical_path = os.path.join(canonical_images_dir, filename)
        img_canonical = cv2.imread(canonical_path, cv2.IMREAD_GRAYSCALE)
        if img_canonical is None: continue
        kp_canonical, des_canonical = orb.detectAndCompute(img_canonical, None)
        if des_canonical is None: continue
        matches = bf.knnMatch(des_canonical, des_new, k=2)
        good_matches = []
        try:
            for m, n in matches:
                if m.distance < LOWE_RATIO * n.distance: good_matches.append(m)
        except ValueError: pass
        if len(good_matches) > best_match_score: best_match_score = len(good_matches)
    print(f"Best match score: {best_match_score}")
    if best_match_score >= MATCH_THRESHOLD:
        message = f"✅ MATCH: Score {best_match_score} >= {MATCH_THRESHOLD}"
        is_match = True
    else:
        message = f"❌ MISMATCH: Score {best_match_score} < {MATCH_THRESHOLD}"
        is_match = False
    return (is_match, best_match_score, message)

# ==============================================================================
# --- REAL-TIME LISTENER LOGIC (Modified to handle ADD, MODIFY, and DELETE) ---
# ==============================================================================
def on_collection_snapshot(collection_snapshot, changes, read_time):
    """Callback that fires when the cart collection changes."""
    for change in changes:
        
        # --- Handle when a NEW item is ADDED to the cart ---
        if change.type.name == 'ADDED':
            barcode_to_verify = change.document.id
            print(f"\n🔔 Item ADDED: {barcode_to_verify}")
            print("🚀 Starting verification process...")
            image_path = capture_image_from_cart_camera()
            if image_path is None: continue
            
            is_match, score, message = verify_product(barcode_to_verify, image_path)
            print(f"--- FINAL RESULT --- \n{message}")
            try:
                doc_ref = db.collection(THIS_CART_ID).document(barcode_to_verify)
                doc_ref.update({'verificationStatus': "MATCH" if is_match else "MISMATCH"})
                print(f"📝 Updated status for '{barcode_to_verify}' in '{THIS_CART_ID}'.")
                
                if is_match:
                    # Read the initial quantity from the source document (defaults to 1)
                    source_data = change.document.to_dict()
                    initial_quantity = source_data.get('quantity', 1)

                    print(f"   -> Success! Logging '{barcode_to_verify}' to '{SUCCESS_COLLECTION_NAME}' with quantity {initial_quantity}.")
                    success_doc_ref = db.collection(SUCCESS_COLLECTION_NAME).document(barcode_to_verify)
                    success_doc_ref.set({'quantity': initial_quantity, 'verifiedAt': firestore.SERVER_TIMESTAMP})
                    print(f"   -> Successfully created document in '{SUCCESS_COLLECTION_NAME}'.")
            except Exception as e:
                print(f"Error during ADD process: {e}")

        # --- NEW LOGIC: Handle when an item's quantity is MODIFIED ---
        elif change.type.name == 'MODIFIED':
            barcode_to_update = change.document.id
            # Get the new data from the changed document in cart_01
            data = change.document.to_dict()
            new_quantity = data.get('quantity')
            
            # If there's no quantity field, we don't know what to do, so we skip.
            if new_quantity is None:
                continue

            print(f"\n🔄 Item MODIFIED: {barcode_to_update}, new quantity: {new_quantity}")
            print(f"   -> Synchronizing new quantity with bill summary '{SUCCESS_COLLECTION_NAME}'...")
            try:
                success_doc_ref = db.collection(SUCCESS_COLLECTION_NAME).document(barcode_to_update)
                # Use .update() to change only the quantity field in cartA
                success_doc_ref.update({'quantity': new_quantity})
                print(f"   -> Successfully updated quantity for '{barcode_to_update}' in '{SUCCESS_COLLECTION_NAME}'.")
            except Exception as e:
                print(f"   -> Error: Could not update quantity for '{barcode_to_update}' in '{SUCCESS_COLLECTION_NAME}'. It may not exist in the bill. Error: {e}")

        # --- Handle when an item is REMOVED from the cart ---
        elif change.type.name == 'REMOVED':
            barcode_to_delete = change.document.id
            print(f"\n🗑️ Item REMOVED: {barcode_to_delete}")
            print(f"   -> Synchronizing deletion with bill summary '{SUCCESS_COLLECTION_NAME}'...")
            try:
                doc_to_delete_ref = db.collection(SUCCESS_COLLECTION_NAME).document(barcode_to_delete)
                doc_to_delete_ref.delete()
                print(f"   -> Successfully removed '{barcode_to_delete}' from '{SUCCESS_COLLECTION_NAME}'. Bill updated.")
            except Exception as e:
                print(f"   -> Info: Could not delete '{barcode_to_delete}'. Error: {e}")

if __name__ == '__main__':
    print(f"--- Starting Cart Synchronization Engine for Cart: {THIS_CART_ID} ---")
    
    collection_ref = db.collection(THIS_CART_ID)
    collection_watch = collection_ref.on_snapshot(on_collection_snapshot)

    print(f"\n⏳ Waiting for item additions, modifications, or deletions in '{THIS_CART_ID}'...")
    while True:
        time.sleep(1)