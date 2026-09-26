if (!customElements.get('hotspot-grid')) {
  customElements.define(
    'hotspot-grid',
    class HotspotGrid extends HTMLElement {
      constructor() {
        super();

        this.dialog = this.querySelector('dialog');
        this.btns = this.querySelectorAll('.hotspot-collection-grid__tracker');
        this.closeBtn = this.querySelector('.quick-view-dialog__close');
        this.loader = this.querySelector('.custom-loading__spinner');
        this.quickview = this.querySelector('.quick-view');
        this.cart = document.querySelector('cart-notification') || document.querySelector('cart-drawer');
        this.upsellVariantId = "50550708043859"; // Soft Winter Jacket - Black Medium
        this.normalize = (v) => v?.toLowerCase().trim();
        this.upsellColors = ["black"];
        this.upsellSizes = ["m", "medium"];
      }


      connectedCallback() {
        // hotspot btns use to toggle popup/dialog
        this.btns?.forEach((btn) =>
          btn.addEventListener('click', () => this.open(btn))
        );

        // handle toggle states
        this.closeBtn?.addEventListener('click', () => this.close());

        this.dialog?.addEventListener('click', (e) => {
          if (e.target === this.dialog) this.close();
        });

        this.quickview?.addEventListener('click', (e) =>
          this.handleATC(e)
        );

        // Esc key
        this.dialog?.addEventListener('close', () => { 
          this.loader?.classList.remove('hidden');  
          this.quickview?.replaceChildren();     
        });
      }

      async open(btn) {
        if (!this.dialog) return;
        // Abort any in-flight request
        this.fetchController?.abort();
        this.fetchController = new AbortController();

        this.dialog.showModal();
        this.loader?.classList.remove('hidden');
        this.quickview?.replaceChildren();

        await this.getMarkup(
          `/products/${btn.dataset.handle}?sections=quick-view`, this.fetchController.signal
        );
      }

      close() {
        this.dialog?.close();
      }

      async getMarkup(uri, signal) {
        try {
          const res = await fetch(uri, { signal });
          if (!res.ok) throw new Error('Quickview fetch failed');

          const data = await res.json();
          const markup = data['quick-view'];

          if (markup && this.quickview) {
            this.quickview.innerHTML = markup;
            this.loader?.classList.add('hidden');
          }
        } catch (e) {
          if (e.name === 'AbortError') return; // Ignore aborted requests
          console.error('Quickview error:', e);
          this.loader?.classList.add('hidden');
          this.quickview.innerHTML = `
            <p class="quick-view-error">Sorry, we couldn't load this product. Please try again.</p>
          `;
        }
      }

      // using here for ease but can be uplifted with events
      async handleATC(event) {
        const button = event.target.closest(
          'button[name="add"][data-atc]'
        );
        if (!button) return;

        event.preventDefault();

        const variantInput = this.quickview?.querySelector('.quick-view-variant-id');

        if (!variantInput?.value) {
          console.error('Variant ID missing');
          return;
        }

        const originalText = button.innerText;

        button.disabled = true;
        button.classList.add('loading');
        button.innerText = 'Adding...';

        const itemsToAdd = [
          {
            id: variantInput.value,
            quantity: 1
          }
        ];

        const variantPicker =  this.quickview.querySelector("variant-picker");
        const selectedOptions = variantPicker?.selectedOptions || {}; // e.g. { Color: 'Black', Size: 'M', Style: 'Slim' }

        // Normalize e.g. Black and black will match
        const selectedColor = this.normalize(selectedOptions['Color'] ?? selectedOptions['Colour'] ?? '');
        const selectedSize  = this.normalize(selectedOptions['Size'] ?? '');

        const hasColorMatch = this.upsellColors.includes(selectedColor);
        const hasSizeMatch  = this.upsellSizes.includes(selectedSize);


        const shouldUpsell = hasColorMatch && hasSizeMatch;

        if (shouldUpsell) {
          itemsToAdd.push({
            id: this.upsellVariantId,
            quantity: 1,
            properties: {
              "_upsell-product": variantInput.value,
              "_upsell-location": "Quick View"
            }
          });
        }

        const payload = {
          items: itemsToAdd
        };

        if (this.cart) {
          payload.sections = this.cart.getSectionsToRender().map((s) => s.id).join(',');
          payload.sections_url = window.location.pathname;
        }

        try {
          const response = await fetch('/cart/add.js', {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: {
              'Content-Type': 'application/json'
            },
          });

          if (!response.ok) throw new Error('Add to cart failed');

          const data = await response.json();

          button.innerText = 'Added!';
          button.classList.remove('loading');
          button.classList.add('success');

          // Cart update
          if (this.cart && data?.sections) {
            publish(PUB_SUB_EVENTS.cartUpdate, {
              source: 'hotspot-grid',
              productVariantId: variantInput.value,
              cartData: data,
            });

            this.cart.renderContents(data);
          } else {
            console.warn('Cart or sections missing');
          }

        } catch (error) {
          console.error('ATC Error:', error);

          button.innerText = 'Error';
          button.classList.remove('loading');
          button.classList.add('error');
        } finally {
          if (this.cart && this.cart.classList.contains('is-empty')) this.cart.classList.remove('is-empty');
          setTimeout(() => {
            button.disabled = false;
            button.innerText = originalText;
            button.classList.remove('success', 'error');
          }, 2000);
          CartPerformance.measureFromEvent("add:user-action", event);
          this.dialog?.close();
        }
      }
    }
  );
}