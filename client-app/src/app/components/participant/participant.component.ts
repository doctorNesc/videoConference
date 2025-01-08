import {
  Component,
  ElementRef,
  HostListener,
  Input,
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
  @ViewChild('resizableElement', { static: true }) resizableElement!: ElementRef;

  resizing = false;
  initialWidth = 0;
  initialHeight = 0;
  initialMouseX = 0;
  initialMouseY = 0;

  onResizeStart(event: MouseEvent): void {
    this.resizing = true;

    const element = this.resizableElement.nativeElement;

    // Capture the initial dimensions and mouse position
    this.initialWidth = element.offsetWidth;
    this.initialHeight = element.offsetHeight;
    this.initialMouseX = event.clientX;
    this.initialMouseY = event.clientY;

    // Prevent default to avoid unwanted behavior during drag
    event.preventDefault();
  }

  @HostListener('window:mousemove', ['$event'])
  onResizing(event: MouseEvent): void {
    if (!this.resizing) return;

    const element = this.resizableElement.nativeElement;

    // Calculate new dimensions
    const deltaX = event.clientX - this.initialMouseX;
    const deltaY = event.clientY - this.initialMouseY;

    const newWidth = Math.max(150, this.initialWidth + deltaX); // Minimum width
    const newHeight = Math.max(150, this.initialHeight + deltaY); // Minimum height

    element.style.width = `${newWidth}px`;
    element.style.height = `${newHeight}px`;
  }
  @HostListener('window:mouseup')
  onResizeEnd(): void {
    this.resizing = false;
  }

  onCornerClick(event: MouseEvent, side?: any) {
    this.resizing = true;
    const element = this.resizableElement.nativeElement;

    // Capture the initial dimensions and mouse position
    this.initialWidth = element.offsetWidth;
    this.initialHeight = element.offsetHeight;
    this.initialMouseX = event.clientX;
    this.initialMouseY = event.clientY;

    // Prevent default to avoid unwanted behavior during drag
    event.preventDefault();

  }
}
