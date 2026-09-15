function installCommunicationsLayoutFix() {
  if (document.querySelector('#mh-communications-layout-fix')) return;
  const style = document.createElement('style');
  style.id = 'mh-communications-layout-fix';
  style.textContent = `
    /* Restore the original Communications spacing after Text / Call Data wrappers are added. */
    #sms-communications-center {
      width: 100%;
      max-width: 100%;
      min-width: 0;
      container-type: inline-size;
    }
    #sms-communications-center,
    #sms-communications-center * {
      box-sizing: border-box;
    }
    #sms-communications-center .mh-text-panel {
      display: grid !important;
      grid-template-columns: minmax(0, 1fr);
      gap: 14px;
      width: 100%;
      max-width: 100%;
      min-width: 0;
    }
    #sms-communications-center .mh-text-panel[hidden] {
      display: none !important;
    }

    /* Header stays inside its own row instead of pushing into the metric cards. */
    #sms-communications-center .sms-center-head {
      display: grid !important;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: start;
      gap: 16px;
      width: 100%;
      max-width: 100%;
      min-width: 0;
    }
    #sms-communications-center .sms-center-head > div,
    #sms-communications-center .sms-center-head p,
    #sms-communications-center .sms-center-actions {
      min-width: 0;
      max-width: 100%;
    }
    #sms-communications-center .sms-center-head p {
      overflow-wrap: anywhere;
    }
    #sms-communications-center .sms-center-actions {
      justify-self: end;
    }

    /* Information boxes are true equal-width grid cells and can never overlap. */
    #sms-communications-center .sms-center-metrics,
    #sms-communications-center .mh-call-summary {
      display: grid !important;
      grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
      gap: 10px !important;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      align-items: stretch;
    }
    #sms-communications-center .sms-center-metrics > div,
    #sms-communications-center .mh-call-summary > div {
      position: relative;
      width: auto !important;
      min-width: 0 !important;
      max-width: 100% !important;
      margin: 0 !important;
      overflow: hidden;
    }
    #sms-communications-center .sms-center-metrics span,
    #sms-communications-center .sms-center-metrics strong,
    #sms-communications-center .mh-call-summary span,
    #sms-communications-center .mh-call-summary strong {
      display: block;
      min-width: 0;
      max-width: 100%;
      overflow-wrap: anywhere;
    }

    /* Conversation rows also respect the available content width beside the sidebar. */
    #sms-communications-center .sms-conversations,
    #sms-communications-center .sms-conversation-card {
      width: 100%;
      max-width: 100%;
      min-width: 0;
    }
    #sms-communications-center .sms-conversation-card {
      grid-template-columns: minmax(0, .8fr) minmax(0, 1.7fr) auto !important;
    }
    #sms-communications-center .sms-conversation-card > * {
      min-width: 0;
      max-width: 100%;
    }

    /* Use the Communications container width, not the full browser width, for responsiveness. */
    @container (max-width: 760px) {
      #sms-communications-center .sms-center-head {
        grid-template-columns: minmax(0, 1fr) !important;
      }
      #sms-communications-center .sms-center-actions {
        justify-self: stretch;
        display: grid !important;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        width: 100%;
      }
      #sms-communications-center .sms-center-actions .btn {
        width: 100%;
        min-width: 0;
      }
      #sms-communications-center .sms-center-metrics,
      #sms-communications-center .mh-call-summary {
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      }
      #sms-communications-center .sms-center-metrics > div:last-child,
      #sms-communications-center .mh-call-summary > div:last-child {
        grid-column: 1 / -1;
      }
      #sms-communications-center .sms-conversation-card {
        grid-template-columns: minmax(0, 1fr) auto !important;
        gap: 8px 10px !important;
      }
      #sms-communications-center .sms-conversation-preview {
        grid-column: 1 / 2;
      }
      #sms-communications-center .sms-conversation-unread,
      #sms-communications-center .sms-conversation-arrow {
        grid-column: 2;
        grid-row: 1 / 3;
        align-self: center;
      }
    }

    @container (max-width: 480px) {
      #sms-communications-center .sms-center-actions,
      #sms-communications-center .sms-center-metrics,
      #sms-communications-center .mh-call-summary {
        grid-template-columns: minmax(0, 1fr) !important;
      }
      #sms-communications-center .sms-center-metrics > div:last-child,
      #sms-communications-center .mh-call-summary > div:last-child {
        grid-column: auto;
      }
    }
  `;
  document.head.append(style);
}

installCommunicationsLayoutFix();
