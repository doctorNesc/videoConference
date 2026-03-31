import {
  Directive,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
} from '@angular/core';

/**
 * Figma-like draggable input directive.
 * Click and drag horizontally to adjust numeric values.
 *
 * Usage:
 * <input type="number" appDraggableInput [step]="0.01" (valueChange)="onValueChange($event)" />
 */
@Directive({
  selector: 'input[type="number"][appDraggableInput]',
  standalone: true,
})
export class DraggableInputDirective {
  @Input() step: number = 1;
  @Output() valueChange = new EventEmitter<number>();

  private isDragging = false;
  private startX = 0;
  private startValue = 0;
  private dragSensitivity = 0.5; // pixels per unit

  constructor(private el: ElementRef<HTMLInputElement>) {}

  @HostListener('mousedown', ['$event'])
  onMouseDown(event: MouseEvent): void {
    this.isDragging = true;
    this.startX = event.clientX;
    this.startValue = parseFloat(this.el.nativeElement.value) || 0;
    this.el.nativeElement.style.cursor = 'ew-resize';
    event.preventDefault();
  }

  @HostListener('document:mousemove', ['$event'])
  onMouseMove(event: MouseEvent): void {
    if (!this.isDragging) return;

    const deltaX = event.clientX - this.startX;
    const deltaValue = (deltaX / this.dragSensitivity) * this.step;
    const newValue = this.startValue + deltaValue;

    // Update the input value
    this.el.nativeElement.value = newValue.toFixed(2);

    // Emit the change event to trigger ngModel update
    this.el.nativeElement.dispatchEvent(new Event('input', { bubbles: true }));
    this.valueChange.emit(newValue);
  }

  @HostListener('document:mouseup')
  onMouseUp(): void {
    if (this.isDragging) {
      this.isDragging = false;
      this.el.nativeElement.style.cursor = 'default';
      // Dispatch change event on mouse up to trigger final update
      this.el.nativeElement.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  @HostListener('focus')
  onFocus(): void {
    this.el.nativeElement.select();
  }
}
