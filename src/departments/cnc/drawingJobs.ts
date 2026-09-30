export type DrawingJob = {
  queueNumber: string;
  customer: string;
  deadline: string;
};

export type CncBench = {
  name: string;
  jobs: DrawingJob[];
};

export const cncBenches: CncBench[] = [
  {
    name: "พรเทพ",
    jobs: [
      { queueNumber: "9012", customer: "ลูกค้าสมมติ ก", deadline: "08.10.2026" },
      { queueNumber: "9018", customer: "ลูกค้าสมมติ ข", deadline: "14.10.2026" },
      { queueNumber: "9024", customer: "ลูกค้าสมมติ ค", deadline: "20.10.2026" },
    ],
  },
  {
    name: "วราพร",
    jobs: [
      { queueNumber: "9015", customer: "ลูกค้าสมมติ ง", deadline: "10.10.2026" },
      { queueNumber: "9021", customer: "ลูกค้าสมมติ จ", deadline: "16.10.2026" },
      { queueNumber: "9027", customer: "ลูกค้าสมมติ ฉ", deadline: "22.10.2026" },
    ],
  },
];
