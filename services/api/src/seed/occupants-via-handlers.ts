import { bookAndAccept } from "./occupants-book";
import { completePt1T1T2, completeThroughT11, completeThroughT13 } from "./occupants-advance";
import { seedAnanyaMoney, seedKarthikMoney, seedMeeraMoney, seedRohanMoney } from "./occupants-money";
import { executeAos, handOverBooking, registerBooking, seedRohanAfterCare } from "./occupants-papers";
import { ANANYA, KARTHIK, MEERA, ROHAN } from "./occupants-ctx";
import { seedCustomerLogins } from "./users";

// Phase 1: four East Crest families through the same handlers the UI uses.

export async function seedOccupantsViaHandlers(): Promise<void> {
  await bookAndAccept(KARTHIK);
  await seedKarthikMoney();
  await executeAos(KARTHIK.booking_id);
  await completePt1T1T2(KARTHIK.booking_id);

  await bookAndAccept(MEERA);
  await seedMeeraMoney();
  await completePt1T1T2(MEERA.booking_id);

  await bookAndAccept(ANANYA);
  await seedAnanyaMoney();
  await executeAos(ANANYA.booking_id);
  await registerBooking(ANANYA.booking_id, "SRO/BNG/2026/4412");
  await completeThroughT11(ANANYA.booking_id);

  await bookAndAccept(ROHAN);
  await seedRohanMoney();
  await executeAos(ROHAN.booking_id);
  await registerBooking(ROHAN.booking_id, "SRO/BNG/2026/3301");
  await completeThroughT13(ROHAN.booking_id);
  await handOverBooking(ROHAN.booking_id);
  await seedRohanAfterCare();

  await seedCustomerLogins();
}
