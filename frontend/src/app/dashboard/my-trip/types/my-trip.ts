export type MyTripEvent = {
  type: "BOARDING" | "DEBOARDING";
  at: string;
  /** null: UniHub sem ônibus ou que não é mais da empresa. */
  busPlate: string | null;
};

export type MyTrip = {
  /** null: o login não tem aluno ativo vinculado. */
  studentName: string | null;
  onBoard: boolean;
  /** Os eventos de hoje, do primeiro ao último. */
  events: MyTripEvent[];
};
