// Sample data for the signed-out demo. None of it is real.
export type PaymentStatus = "waiting" | "private" | "out";

export interface Payment {
  id: string;
  when: string;
  counterparty: string;
  amount: number;
  status: PaymentStatus;
}

export const SAMPLE_PAYMENTS: Payment[] = [
  { id: "p5", when: "Today, 14:02", counterparty: "7xK2…9fQa", amount: 120, status: "waiting" },
  { id: "p4", when: "Today, 09:41", counterparty: "Fh3n…c2Ld", amount: 450, status: "private" },
  { id: "p3", when: "Yesterday, 17:20", counterparty: "Bq7r…m8Ye", amount: 75.5, status: "private" },
  { id: "p2", when: "6 Oct, 11:05", counterparty: "Ds4w…x0Hn", amount: 1000, status: "private" },
  { id: "c1", when: "5 Oct, 16:30", counterparty: "4tNb…Wq7e", amount: -280, status: "out" },
  { id: "p1", when: "3 Oct, 08:12", counterparty: "Yz6e…k4Ra", amount: 1235, status: "private" },
];

export const SAMPLE_BALANCE = 2480.5;
export const SAMPLE_HANDLE = "demo";
