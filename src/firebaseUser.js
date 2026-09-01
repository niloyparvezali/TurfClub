import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";

export async function createUserProfile(user, name) {
  await setDoc(doc(db, "users", user.uid), {
    name,
    email: user.email || "",
    role: "user",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}
