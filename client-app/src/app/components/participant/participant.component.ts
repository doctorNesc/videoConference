import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-participant',
  standalone: true,
  imports: [],
  templateUrl: './participant.component.html',
  styleUrl: './participant.component.scss'
})
export class ParticipantComponent {
  @Input() stream!: MediaStream;

  detachWindow() {
    const videoHtml = `
      <html>
        <head>
          <title>Participant Video</title>
          <style>
            body {
              margin: 0;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
            }
            video {
              width: 100%;
              height: auto;
            }
          </style>
        </head>
        <body>
          <video id="externalVideo" controls autoplay></video>
          <script>
            window.onload = () => {
              const videoElem = document.getElementById('externalVideo');
              window.opener.postMessage({ action: 'transferStream' }, '*');

              window.addEventListener('message', (event) => {
                if (event.data.action === 'provideStream') {
                  videoElem.srcObject = event.data.stream;
                  videoElem.play();
                }
              });
            };
          </script>
        </body>
      </html>
    `;

    const newWindow = window.open('', '', 'width=600,height=400');
    if (newWindow) {
      newWindow.document.write(videoHtml);
      newWindow.document.close();

      // Send the stream to the new window after it is loaded
      window.addEventListener('message', (event) => {
        if (event.data.action === 'transferStream') {
          newWindow.postMessage({ action: 'provideStream', stream: this.stream }, '*');
        }
      });
    }
  }
}