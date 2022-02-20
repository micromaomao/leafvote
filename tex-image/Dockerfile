# TODO: move this to leafvote repo
FROM archlinux/archlinux
RUN pacman -Syu --noconfirm && \
    pacman -S --noconfirm grep git make curl && \
    pacman -S --noconfirm texlive-bibtexextra texlive-bin texlive-core texlive-fontsextra texlive-formatsextra texlive-langchinese texlive-latexextra texlive-pictures texlive-pstricks texlive-science ghostscript

COPY entrypoint /entrypoint
RUN chmod a+rx /entrypoint
ENTRYPOINT [ "/entrypoint" ]
WORKDIR /tmp/
USER nobody:nobody
