// Sample data for the signed-out demo. None of it is real.
export type PaymentStatus = "waiting" | "private" | "out";

export interface Payment {
  id: string;
  when: string;
  /** Days before today, used to group and chart. */
  daysAgo: number;
  /** The other side, when known. Chain scans do not know the payer. */
  counterparty: string | null;
  amount: number;
  /** False for shielded amounts, which stay hidden until they are decrypted. */
  amountKnown: boolean;
  status: PaymentStatus;
}

export const SAMPLE_PAYMENTS: Payment[] = [
  { id: "p5", when: "Today, 14:02", daysAgo: 0, counterparty: "7xK2…9fQa", amount: 120, amountKnown: true, status: "waiting" },
  { id: "p4", when: "Today, 09:41", daysAgo: 0, counterparty: "Fh3n…c2Ld", amount: 450, amountKnown: true, status: "private" },
  { id: "p3", when: "Yesterday, 17:20", daysAgo: 1, counterparty: "Bq7r…m8Ye", amount: 75.5, amountKnown: true, status: "private" },
  { id: "p2", when: "3 days ago, 11:05", daysAgo: 3, counterparty: "Ds4w…x0Hn", amount: 1000, amountKnown: true, status: "private" },
  { id: "c1", when: "4 days ago, 16:30", daysAgo: 4, counterparty: "4tNb…Wq7e", amount: -280, amountKnown: true, status: "out" },
  { id: "p1", when: "6 days ago, 08:12", daysAgo: 6, counterparty: "Yz6e…k4Ra", amount: 1235, amountKnown: true, status: "private" },
];

export const SAMPLE_BALANCE = 2480.5;
export const SAMPLE_HANDLE = "demo";
