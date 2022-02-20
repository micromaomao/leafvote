RUSTC ?= rustc
RUSTC_FLAGS ?= -C opt-level=3
.PHONY: clean everything
everything: entrypoint
clean:
	rm -f entrypoint entrypoint.d in.*
entrypoint: entrypoint.rs
	$(RUSTC) --edition=2018 --crate-name entrypoint entrypoint.rs --color always --crate-type bin $(RUSTC_FLAGS)
