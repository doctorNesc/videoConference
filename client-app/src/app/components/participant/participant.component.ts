import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
  ViewChild,
} from '@angular/core';

@Component({
  selector: 'app-participant',
  standalone: true,
  imports: [],
  templateUrl: './participant.component.html',
  styleUrl: './participant.component.scss',
})
export class ParticipantComponent {
  @Input() stream!: MediaStream;
  @Input() isMain: boolean = false;
  @Input() userName: string = '';
  @Output() setMainParticipant = new EventEmitter();
  @Output() detach = new EventEmitter();

  resizing = false;
  initialWidth = 0;
  initialHeight = 0;
  initialMouseX = 0;
  initialMouseY = 0;

  
}
