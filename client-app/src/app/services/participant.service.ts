import { Participant } from "#app/utils/types.js";
import { Injectable } from "@angular/core";
import { BehaviorSubject } from "rxjs";

@Injectable({ providedIn: 'root' })
export class ParticipantService {
  private participants$ = new BehaviorSubject<Participant[]>([]);
  private detached$ = new BehaviorSubject<Participant[]>([]);

  get participants() {
    return this.participants$.asObservable();
  }

  add(participant: Participant) {
    this.participants$.next([...this.participants$.value, participant]);
  }

  remove(id: string) {
    this.participants$.next(this.participants$.value.filter(p => p.id !== id));
  }

  detach(id: string) {
    const participant = this.participants$.value.find(p => p.id === id);
    if (participant) {
      this.remove(id);
      this.detached$.next([...this.detached$.value, participant]);
    }
  }

  reattach(id: string) {
    const participant = this.detached$.value.find(p => p.id === id);
    if (participant) {
      this.add(participant);
      this.detached$.next(this.detached$.value.filter(p => p.id !== id));
    }
  }
}
