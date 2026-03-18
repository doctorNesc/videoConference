export type Participant = {
  id: string;
  stream: MediaStream;
  name: string;
  /** Legacy: socket ID of the main room device this participant is assigned to */
  assignedMainRoomDevice?: string;
  socketId?: string;
  /**
   * True when this participant's stream is the camera feed assigned to the
   * remote participant's screen slot (used to set it as the main view).
   */
  isAssignedCamera?: boolean;
};
