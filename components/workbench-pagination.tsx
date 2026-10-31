"use client";

import React, { useEffect } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import "./workbench-pagination.css";

type PaginationProps = {
  page: number;
  setPage: (page: number) => void;
  total: number;
  size?: number;
};

const GROUP_SIZE = 20;
const formatCount = (value: number) => new Intl.NumberFormat("zh-CN").format(value);

export default function Pagination({ page, setPage, total, size = 12 }: PaginationProps) {
  const count = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const pageSize = Number.isFinite(size) && size > 0 ? Math.max(1, Math.floor(size)) : 12;
  const pages = Math.max(1, Math.ceil(count / pageSize));
  const requestedPage = Number.isFinite(page) ? Math.floor(page) : 1;
  const currentPage = Math.min(pages, Math.max(1, requestedPage));
  const groupStart = Math.floor((currentPage - 1) / GROUP_SIZE) * GROUP_SIZE + 1;
  const groupEnd = Math.min(pages, groupStart + GROUP_SIZE - 1);
  const previousStart = Math.max(1, groupStart - GROUP_SIZE);
  const nextStart = groupStart + GROUP_SIZE;
  const hasPreviousGroup = groupStart > 1;
  const hasNextGroup = groupEnd < pages;
  const firstItem = count ? (currentPage - 1) * pageSize + 1 : 0;
  const lastItem = Math.min(currentPage * pageSize, count);
  const pageNumbers = Array.from({ length: groupEnd - groupStart + 1 }, (_, index) => groupStart + index);

  useEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [page, currentPage, setPage]);

  const jumpTo = (target: number) => {
    const nextPage = Math.min(pages, Math.max(1, target));
    if (nextPage !== currentPage) setPage(nextPage);
  };

  return <section className="wb-pagination" aria-label="表格分页">
    <div className="wb-pagination-top">
      <span className="wb-pagination-summary" aria-live="polite">共 {formatCount(count)} 条 · 当前 {formatCount(firstItem)}–{formatCount(lastItem)} 条</span>
      <div className="wb-pagination-shortcuts">
        <button type="button" className="wb-pagination-edge" disabled={!count || currentPage === 1} onClick={() => jumpTo(1)} aria-label="跳到首页">首页</button>
        <button type="button" className="wb-pagination-arrow" disabled={!count || currentPage === 1} onClick={() => jumpTo(currentPage - 1)} aria-label="上一页"><ChevronLeft size={15} aria-hidden="true" /></button>
        <span className="wb-pagination-position">第 <strong>{currentPage}</strong> / {pages} 页</span>
        <button type="button" className="wb-pagination-arrow" disabled={!count || currentPage === pages} onClick={() => jumpTo(currentPage + 1)} aria-label="下一页"><ChevronRight size={15} aria-hidden="true" /></button>
        <button type="button" className="wb-pagination-edge" disabled={!count || currentPage === pages} onClick={() => jumpTo(pages)} aria-label={`跳到末页，第 ${pages} 页`}>末页</button>
      </div>
    </div>
    <div className="wb-pagination-group">
      <button type="button" className="wb-pagination-group-button previous" disabled={!hasPreviousGroup || !count} onClick={() => jumpTo(previousStart)} aria-label={hasPreviousGroup ? `上一组，第 ${previousStart} 至 ${groupStart - 1} 页，跳到第 ${previousStart} 页` : "没有上一组页码"}>
        <ChevronsLeft size={15} aria-hidden="true" /><span>上一组{hasPreviousGroup && <small>{previousStart}–{groupStart - 1} 页</small>}</span>
      </button>
      <nav className="wb-pagination-numbers" aria-label={`页码，第 ${groupStart} 至 ${groupEnd} 页`}>
        {pageNumbers.map(number => <button type="button" className={`wb-pagination-number${number === currentPage ? " active" : ""}`} key={number} aria-label={`第 ${number} 页`} aria-current={number === currentPage ? "page" : undefined} disabled={!count} onClick={() => jumpTo(number)}>{number}</button>)}
      </nav>
      <button type="button" className="wb-pagination-group-button next" disabled={!hasNextGroup || !count} onClick={() => jumpTo(nextStart)} aria-label={hasNextGroup ? `下一组，第 ${nextStart} 至 ${Math.min(pages, nextStart + GROUP_SIZE - 1)} 页，跳到第 ${nextStart} 页` : "没有下一组页码"}>
        <span>下一组{hasNextGroup && <small>{nextStart}–{Math.min(pages, nextStart + GROUP_SIZE - 1)} 页</small>}</span><ChevronsRight size={15} aria-hidden="true" />
      </button>
    </div>
  </section>;
}
