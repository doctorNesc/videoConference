import { Directive, ElementRef, HostListener, Renderer2 } from '@angular/core';

@Directive({
  selector: '[appResizable]',
  standalone:true
})
export class ResizableDirective {
  private resizing = false;
  private initialWidth: number = 0;
  private initialHeight: number = 0;
  private startX: number = 0;
  private startY: number = 0;

  constructor(private el: ElementRef, private renderer: Renderer2) {}

  @HostListener('mousedown', ['$event'])
  onMouseDown(event: MouseEvent) {
    this.resizing = true;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.initialWidth = this.el.nativeElement.offsetWidth;
    this.initialHeight = this.el.nativeElement.offsetHeight;

    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mouseup', this.onMouseUp);
  }

  private onMouseMove = (event: MouseEvent) => {
    if (!this.resizing) return;

    const deltaX = event.clientX - this.startX;
    const deltaY = event.clientY - this.startY;

    const newWidth = Math.max(this.initialWidth + deltaX, 100);
    const newHeight = Math.max(this.initialHeight + deltaY, 100);

    this.renderer.setStyle(this.el.nativeElement, 'width', `${newWidth}px`);
    this.renderer.setStyle(this.el.nativeElement, 'height', `${newHeight}px`);

    
    this.updateGrid();
  };

  private onMouseUp = () => {
    this.resizing = false;
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
  };

  private updateGrid() {
    const parent = this.el.nativeElement.parentElement;
    parent.style.display = 'none'; 
    parent.offsetHeight; 
    parent.style.display = 'grid';
  }
}
